# Manual "Check for updates" button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю вручную запускать проверку обновлений из тайтлбара и из Settings → About; результат всегда показывается тостом, а отложенное («Later») обновление остаётся видимым бейджем на иконке тайтлбара.

**Architecture:** Расширяем существующий слайс `src/features/updater/`. Хук `useUpdateCheck` получает `recheck()` + флаги `manual` (ручная vs авто-проверка) и `hasUpdate` (латч доступности, переживающий `dismiss`). Лёгкий контекст `UpdaterProvider` (по образцу `CatalogProvider`) расшаривает инстанс хука из `WorkflowApp` в `AboutPane`. `Titlebar` получает опциональные пропсы (иконка-кнопка + бейдж). `UpdateToast` показывает результат «тихих» фаз только при `manual`.

**Tech Stack:** React 18, TypeScript, Vitest + React Testing Library, sonner, lucide-react, `@tauri-apps/plugin-updater`.

**Status banner:** ✅ **DONE** — все 6 задач выполнены, закоммичены (`77d9d2c`…`e34443f`), TDD. `pnpm test` 635 зелёных, `pnpm lint` (tsc -b) чисто. Финальное холистическое ревью — «Ship it» (ни критичных, ни важных замечаний; подтверждено отсутствие двойной проверки под StrictMode, корректный латч `hasUpdate`). **Влито в `main`** fast-forward → `8f364a4`. Живая проверка в WebView2: ⟳-клик → «Checking…» → «You're on the latest version.» **Остаток:** ручной mac/WKWebView-проход (бейдж-точка, спиннер) — для человека. · **Дата:** 2026-06-09 · **Ветка:** `claude/modest-joliot-8efb0b` · **Спек:** [docs/superpowers/specs/archive/2026-06-09-check-for-updates-button-design.md](../../specs/archive/2026-06-09-check-for-updates-button-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/features/updater/useUpdateCheck.ts` | хук: + `recheck()`, флаги `manual`/`hasUpdate`, `dismiss` сохраняет латч |
| `src/features/updater/useUpdateCheck.test.tsx` | юнит-тесты хука (+ recheck/manual/hasUpdate) |
| `src/features/updater/updaterContext.tsx` | новый: `UpdaterProvider` + `useUpdater()` |
| `src/features/updater/UpdateToast.tsx` | + результат ручной проверки (`checking`/`upToDate`/`error`), проп `manual` |
| `src/features/updater/UpdateToast.test.tsx` | + тесты manual-фаз |
| `src/features/shell/Titlebar.tsx` | + опц. пропсы, иконка-кнопка, бейдж доступности |
| `src/features/shell/Titlebar.test.tsx` | + тесты кнопки и бейджа |
| `src/features/settings/AboutPane.tsx` | + группа Updates (одна кнопка) |
| `src/features/settings/AboutPane.test.tsx` | новый |
| `src/app/WorkflowApp.tsx` | обернуть в `UpdaterProvider`; пропсы в `Titlebar`; `manual` в `UpdateToast` |

**Команды:** фокусный прогон — `pnpm vitest run <path>`; полный — `pnpm test`; типы — `pnpm lint`.

---

## Task 1: `useUpdateCheck` — `recheck()` + флаги `manual`/`hasUpdate`

**Files:**
- Modify: `src/features/updater/useUpdateCheck.ts`
- Test: `src/features/updater/useUpdateCheck.test.tsx`

Выносим логику проверки в стабильный `run(manual)` (зовётся на mount с `false` и из `recheck()` с `true`). Добавляем латч `hasUpdate` (переживает `dismiss`), guard `inFlight` (нет наложения проверок/загрузок), `mountedRef` (unmount-safety). `install()` сохраняет текущее поведение (существующие тесты должны остаться зелёными).

- [ ] **Step 1: Дописать падающие тесты**

Добавить эти три теста ВНУТРЬ существующего `describe("useUpdateCheck", () => { … })` в `src/features/updater/useUpdateCheck.test.tsx` (после теста `dismiss() hides the banner`):

```tsx
  it("recheck() re-runs the check and flags it manual + latches hasUpdate", async () => {
    check.mockResolvedValue(null); // mount → upToDate
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("upToDate"));
    expect(result.current.manual).toBe(false);
    expect(result.current.hasUpdate).toBe(false);

    check.mockResolvedValue(fakeUpdate()); // next check → available
    act(() => {
      result.current.recheck();
    });
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.manual).toBe(true);
    expect(result.current.hasUpdate).toBe(true);
  });

  it("dismiss() hides the toast but keeps hasUpdate + version for the titlebar badge", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
    expect(result.current.hasUpdate).toBe(true);
    expect(result.current.version).toBe("0.2.0");
  });

  it("recheck() is a no-op while a download is in flight", async () => {
    let resolveDl: () => void = () => {};
    const downloadAndInstall = vi.fn(
      () => new Promise<void>((res) => { resolveDl = res; }),
    );
    check.mockResolvedValue(fakeUpdate({ downloadAndInstall }));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));

    act(() => {
      void result.current.install();
    });
    await waitFor(() => expect(result.current.phase).toBe("downloading"));

    check.mockClear();
    act(() => {
      result.current.recheck();
    });
    expect(check).not.toHaveBeenCalled();
    resolveDl();
  });
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `pnpm vitest run src/features/updater/useUpdateCheck.test.tsx`
Expected: FAIL — `result.current.recheck is not a function` / `manual`/`hasUpdate` undefined.

- [ ] **Step 3: Переписать хук**

Полностью заменить содержимое `src/features/updater/useUpdateCheck.ts` на:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "installError"
  | "error";

interface UpdateState {
  phase: UpdatePhase;
  version: string;
  progress: number;
  /** True when the in-flight/last check was user-initiated (vs the silent mount check). */
  manual: boolean;
  /** Latched availability: stays true after dismiss() so the titlebar can show a badge. */
  hasUpdate: boolean;
}

export interface UseUpdateCheck extends UpdateState {
  install: () => Promise<void>;
  dismiss: () => void;
  recheck: () => void;
}

export function useUpdateCheck(): UseUpdateCheck {
  const [state, setState] = useState<UpdateState>({
    phase: "checking",
    version: "",
    progress: 0,
    manual: false,
    hasUpdate: false,
  });
  // Hold the Update object returned by check() so install() can act on it.
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);
  // Guards against overlapping checks/downloads (double clicks, recheck mid-download).
  const inFlight = useRef(false);
  // Avoid setState after unmount.
  const mounted = useRef(true);

  const run = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, phase: "checking", progress: 0, manual }));
    try {
      const update = await check();
      if (!mounted.current) return;
      if (update) {
        updateRef.current = update;
        setState((s) => ({ ...s, phase: "available", version: update.version, progress: 0, manual, hasUpdate: true }));
      } else {
        updateRef.current = null;
        setState((s) => ({ ...s, phase: "upToDate", version: "", progress: 0, manual, hasUpdate: false }));
      }
    } catch {
      // Swallow (incl. running outside Tauri) — keep the last-known availability latch.
      if (mounted.current) setState((s) => ({ ...s, phase: "error", manual }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run(false);
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const recheck = useCallback(() => {
    void run(true);
  }, [run]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    inFlight.current = true;
    let total = 0;
    let downloaded = 0;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          setState((s) => ({ ...s, progress: pct }));
        }
      });
      await relaunch();
    } catch (err) {
      // On success relaunch() ends the process and we never get here; reaching the
      // catch means the download/install failed — surface a distinct error phase
      // (keeping the version) so the UI can show a failure + retry, not silently revert.
      setState((s) => ({ ...s, phase: "installError", progress: 0 }));
      throw err;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    // Hide the toast only — keep hasUpdate + version so the titlebar badge persists.
    setState((s) => ({ ...s, phase: "idle", progress: 0 }));
  }, []);

  return { ...state, install, dismiss, recheck };
}
```

- [ ] **Step 4: Запустить — убедиться, что зелено (включая старые тесты)**

Run: `pnpm vitest run src/features/updater/useUpdateCheck.test.tsx`
Expected: PASS — все тесты (старые install/dismiss/error + 3 новых).

- [ ] **Step 5: Commit**

```bash
git add src/features/updater/useUpdateCheck.ts src/features/updater/useUpdateCheck.test.tsx
git commit -m "feat(updater): recheck() + manual/hasUpdate flags in useUpdateCheck"
```

---

## Task 2: `UpdaterProvider` + `useUpdater()` контекст

**Files:**
- Create: `src/features/updater/updaterContext.tsx`
- Test: `src/features/updater/updaterContext.test.tsx`

Лёгкий контекст по образцу `src/features/catalog/CatalogProvider.tsx`. Расшаривает один инстанс `UseUpdateCheck` из `WorkflowApp` в `AboutPane`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/updater/updaterContext.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { UpdaterProvider, useUpdater } from "./updaterContext";
import type { UseUpdateCheck } from "./useUpdateCheck";

const fake: UseUpdateCheck = {
  phase: "idle",
  version: "",
  progress: 0,
  manual: false,
  hasUpdate: false,
  install: async () => {},
  dismiss: () => {},
  recheck: () => {},
};

describe("useUpdater", () => {
  it("returns the provided updater instance", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UpdaterProvider value={fake}>{children}</UpdaterProvider>
    );
    const { result } = renderHook(() => useUpdater(), { wrapper });
    expect(result.current).toBe(fake);
  });

  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useUpdater())).toThrow(/UpdaterProvider/);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run src/features/updater/updaterContext.test.tsx`
Expected: FAIL — `Cannot find module './updaterContext'`.

- [ ] **Step 3: Реализовать контекст**

Создать `src/features/updater/updaterContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { UseUpdateCheck } from "./useUpdateCheck";

const UpdaterContext = createContext<UseUpdateCheck | null>(null);

/** Shares the ONE updater-hook instance from WorkflowApp with deep consumers (About pane). */
export function UpdaterProvider({ value, children }: { value: UseUpdateCheck; children: ReactNode }) {
  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

/** Read the shared updater instance. Must be rendered under <UpdaterProvider>. */
export function useUpdater(): UseUpdateCheck {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within <UpdaterProvider>");
  return ctx;
}
```

- [ ] **Step 4: Запустить — убедиться, что зелено**

Run: `pnpm vitest run src/features/updater/updaterContext.test.tsx`
Expected: PASS (2 теста).

- [ ] **Step 5: Commit**

```bash
git add src/features/updater/updaterContext.tsx src/features/updater/updaterContext.test.tsx
git commit -m "feat(updater): UpdaterProvider + useUpdater context"
```

---

## Task 3: `UpdateToast` — результат ручной проверки

**Files:**
- Modify: `src/features/updater/UpdateToast.tsx`
- Test: `src/features/updater/UpdateToast.test.tsx`

Новый опциональный проп `manual` (по умолчанию `false`). Для `manual` добавляются тосты `checking` (loading) / `upToDate` (success, сам исчезает) / `error` (error, сам исчезает). Фазы `available`/`downloading`/`installError` — как раньше, всегда. Существующие тесты не трогаем (manual по умолчанию `false`), только добавляем `toast.success` в мок и новые тесты.

- [ ] **Step 1: Дописать падающие тесты + расширить мок**

В `src/features/updater/UpdateToast.test.tsx` заменить hoisted-блок мока (добавить `success`):

```tsx
type ToastMock = Mock & { loading: Mock; error: Mock; success: Mock; dismiss: Mock };

// One shared mock for the sonner `toast` callable + its .loading/.error/.success/.dismiss.
const { toastMock } = vi.hoisted(() => {
  const t = vi.fn(() => "toast-1") as ToastMock;
  t.loading = vi.fn(() => "toast-1");
  t.error = vi.fn(() => "toast-1");
  t.success = vi.fn(() => "toast-1");
  t.dismiss = vi.fn();
  return { toastMock: t };
});
```

Затем добавить эти тесты ВНУТРЬ `describe("UpdateToast", () => { … })` (после теста `dismisses the open toast …`):

```tsx
  it("shows a success toast on a MANUAL up-to-date result", () => {
    render(<UpdateToast phase="upToDate" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.success.mock.calls[0][0]).toMatch(/latest version/i);
    const opts = toastMock.success.mock.calls[0][1] as { duration: number; position: string };
    expect(opts.duration).toBeGreaterThan(0);
    expect(opts.duration).not.toBe(Infinity);
    expect(opts.position).toBe("bottom-right");
  });

  it("shows an error toast on a MANUAL check failure", () => {
    render(<UpdateToast phase="error" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error.mock.calls[0][0]).toMatch(/couldn't check/i);
  });

  it("shows a loading toast while a MANUAL check is running", () => {
    render(<UpdateToast phase="checking" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.loading).toHaveBeenCalledTimes(1);
    expect(toastMock.loading.mock.calls[0][0]).toMatch(/checking for updates/i);
  });

  it("stays silent for the same phases when the check is NOT manual (startup)", () => {
    render(<UpdateToast phase="upToDate" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    render(<UpdateToast phase="error" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    render(<UpdateToast phase="checking" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.loading).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `pnpm vitest run src/features/updater/UpdateToast.test.tsx`
Expected: FAIL — `toastMock.success` не вызывался (логика ещё не добавлена).

- [ ] **Step 3: Расширить компонент**

Полностью заменить содержимое `src/features/updater/UpdateToast.tsx` на:

```tsx
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UpdatePhase } from "./useUpdateCheck";

export interface UpdateToastProps {
  phase: UpdatePhase;
  version: string;
  progress: number;
  /** Was the latest check user-initiated? Gates the "checking/up-to-date/error" toasts so
   *  the silent startup check never raises a "You're on the latest version" note. */
  manual?: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Headless Postman-style updater notification driven by useUpdateCheck.
 *  Renders nothing — it owns a single sonner toast keyed by id and updates it in
 *  place across the lifecycle. Manual checks also surface their result. */
export function UpdateToast({ phase, version, progress, manual = false, onUpdate, onDismiss }: UpdateToastProps) {
  // The id of the toast we currently own, so every phase updates the SAME note.
  const idRef = useRef<string | number | null>(null);

  useEffect(() => {
    const id = idRef.current ?? undefined;
    // sonner deletes a toast after its ACTION button is clicked unless the handler
    // calls preventDefault(); we morph the SAME toast in place, so keep it alive.
    const triggerUpdate = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onUpdate();
    };
    if (phase === "available") {
      idRef.current = toast(`A new version (${version}) is available.`, {
        id,
        duration: Infinity,
        position: "bottom-right",
        action: { label: "Update now", onClick: triggerUpdate },
        cancel: { label: "Later", onClick: onDismiss },
      });
    } else if (phase === "downloading") {
      // Explicit undefined clears the available toast's buttons (sonner merges old+new).
      idRef.current = toast.loading(`Downloading update ${version}… ${progress}%`, {
        id,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (phase === "installError") {
      idRef.current = toast.error("Update failed. Please try again.", {
        id,
        duration: Infinity,
        position: "bottom-right",
        action: { label: "Retry", onClick: triggerUpdate },
        cancel: { label: "Later", onClick: onDismiss },
      });
    } else if (manual && phase === "checking") {
      idRef.current = toast.loading("Checking for updates…", {
        id,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (manual && phase === "upToDate") {
      idRef.current = toast.success("You're on the latest version.", {
        id,
        duration: 4000,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (manual && phase === "error") {
      idRef.current = toast.error("Couldn't check for updates.", {
        id,
        duration: 4000,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (idRef.current != null) {
      // idle, or a non-manual checking/upToDate/error → no actionable toast; clear ours.
      toast.dismiss(idRef.current);
      idRef.current = null;
    }
  }, [phase, version, progress, manual, onUpdate, onDismiss]);

  return null;
}
```

- [ ] **Step 4: Запустить — убедиться, что зелено (старые + новые)**

Run: `pnpm vitest run src/features/updater/UpdateToast.test.tsx`
Expected: PASS — все тесты.

- [ ] **Step 5: Commit**

```bash
git add src/features/updater/UpdateToast.tsx src/features/updater/UpdateToast.test.tsx
git commit -m "feat(updater): manual-check result toasts (checking/up-to-date/error)"
```

---

## Task 4: `Titlebar` — иконка-кнопка + бейдж

**Files:**
- Modify: `src/features/shell/Titlebar.tsx`
- Test: `src/features/shell/Titlebar.test.tsx`

Опциональные пропсы `onCheckForUpdates` / `updatePhase` / `updateAvailable`. Кнопка рендерится только при наличии `onCheckForUpdates`, поэтому существующие рендеры `Titlebar` в тестах не ломаются.

- [ ] **Step 1: Дописать падающие тесты**

В `src/features/shell/Titlebar.test.tsx` добавить эти тесты ВНУТРЬ `describe("Titlebar (both platforms)", () => { … })` (после теста `calls onOpenSettings …`):

```tsx
  it("renders a check-for-updates button that calls onCheckForUpdates", async () => {
    const onCheckForUpdates = vi.fn();
    const user = userEvent.setup();
    render(<Titlebar onOpenSettings={() => {}} onCheckForUpdates={onCheckForUpdates} updatePhase="idle" />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("omits the check button without a handler and disables it while checking", () => {
    const { rerender } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    rerender(<Titlebar onOpenSettings={() => {}} onCheckForUpdates={() => {}} updatePhase="checking" />);
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
  });

  it("shows the update-available badge when an update is pending (even when idle)", () => {
    render(<Titlebar onOpenSettings={() => {}} onCheckForUpdates={() => {}} updatePhase="idle" updateAvailable />);
    expect(screen.getByTestId("update-available-dot")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Запустить — убедиться, что падают**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: FAIL — кнопка `Check for updates` не найдена.

- [ ] **Step 3: Реализовать кнопку + бейдж**

В `src/features/shell/Titlebar.tsx`:

(a) Добавить импорт `RefreshCw` в существующую строку lucide (в начало списка иконок) и импорт типа `UpdatePhase`:

```tsx
import { Minus, Moon, PanelLeft, RefreshCw, Settings, Square, Sun, X } from "lucide-react";
```

Добавить рядом с прочими импортами:

```tsx
import type { UpdatePhase } from "@/features/updater/useUpdateCheck";
```

(b) Заменить сигнатуру функции:

```tsx
export function Titlebar({ onOpenSettings }: { onOpenSettings: () => void }) {
```

на:

```tsx
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
```

(c) Вставить кнопку проверки прямо ПЕРЕД блоком `<Tooltip content="Settings" …>`:

```tsx
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
```

- [ ] **Step 4: Запустить — убедиться, что зелено (все 3 describe-блока)**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: PASS — старые + 3 новых.

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/Titlebar.tsx src/features/shell/Titlebar.test.tsx
git commit -m "feat(titlebar): check-for-updates button + update-available badge"
```

---

## Task 5: `AboutPane` — группа Updates с кнопкой

**Files:**
- Modify: `src/features/settings/AboutPane.tsx`
- Test: `src/features/settings/AboutPane.test.tsx`

Через `useUpdater()` добавляем группу с одной кнопкой «Check for updates» (стиль `Button variant="outline" size="xs"`, как в `DataPane`). Результат показывает тост — инлайн-статуса нет.

- [ ] **Step 1: Написать падающий тест**

Создать `src/features/settings/AboutPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutPane } from "./AboutPane";
import { UpdaterProvider } from "@/features/updater/updaterContext";
import type { UseUpdateCheck } from "@/features/updater/useUpdateCheck";

vi.mock("@/ipc/client", () => ({
  ipc: { appVersion: vi.fn().mockResolvedValue("1.2.3") },
}));

function makeUpdater(over: Partial<UseUpdateCheck> = {}): UseUpdateCheck {
  return {
    phase: "idle",
    version: "",
    progress: 0,
    manual: false,
    hasUpdate: false,
    install: async () => {},
    dismiss: () => {},
    recheck: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AboutPane", () => {
  it("renders a Check for updates button that triggers a recheck", async () => {
    const recheck = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdaterProvider value={makeUpdater({ recheck })}>
        <AboutPane />
      </UpdaterProvider>,
    );
    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a check is in flight", () => {
    render(
      <UpdaterProvider value={makeUpdater({ phase: "checking" })}>
        <AboutPane />
      </UpdaterProvider>,
    );
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run src/features/settings/AboutPane.test.tsx`
Expected: FAIL — кнопка не найдена (группы Updates ещё нет).

- [ ] **Step 3: Реализовать**

Полностью заменить содержимое `src/features/settings/AboutPane.tsx` на:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { useUpdater } from "@/features/updater/updaterContext";

export function AboutPane() {
  const [version, setVersion] = useState("");
  const { phase, recheck } = useUpdater();
  const busy = phase === "checking" || phase === "downloading";
  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);
  return (
    <>
      <SettingsGroup title="Handshaker">
        <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
          A gRPC client for the rest of us. No accounts, no telemetry, no nonsense.
        </p>
        <div className="grid gap-1.5 font-mono text-[11.5px] text-muted-foreground mt-1">
          <div>
            version <span className="text-foreground">{version || "0.0.0"}</span>
          </div>
          <div>
            runtime <span className="text-foreground">tauri 2 · react 18</span>
          </div>
          <div>
            license <span className="text-foreground">see LICENSE</span>
          </div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Updates">
        <SettingsRow
          title="Check for updates"
          hint="Looks for a newer release and notifies you if one is available."
          control={
            <Button variant="outline" size="xs" onClick={() => recheck()} disabled={busy}>
              {busy ? "Checking…" : "Check for updates"}
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}
```

- [ ] **Step 4: Запустить — убедиться, что зелено**

Run: `pnpm vitest run src/features/settings/AboutPane.test.tsx`
Expected: PASS (2 теста).

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/AboutPane.tsx src/features/settings/AboutPane.test.tsx
git commit -m "feat(settings): Check for updates button in About pane"
```

---

## Task 6: Связать всё в `WorkflowApp` (провайдер + пропсы)

**Files:**
- Modify: `src/app/WorkflowApp.tsx`

`WorkflowApp` уже держит `const update = useUpdateCheck()`. Оборачиваем дерево в `UpdaterProvider value={update}` (чтобы `AboutPane` через `SettingsDialog` видел инстанс), передаём пропсы в `Titlebar` и `manual` в `UpdateToast`.

- [ ] **Step 1: Добавить импорт провайдера**

Рядом с существующими импортами апдейтера в `src/app/WorkflowApp.tsx`:

```tsx
import { useUpdateCheck } from "@/features/updater/useUpdateCheck";
import { UpdateToast } from "@/features/updater/UpdateToast";
import { UpdaterProvider } from "@/features/updater/updaterContext";
```

- [ ] **Step 2: Обернуть дерево в провайдер**

Заменить открывающий тег корневого `div` в `return (` :

```tsx
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
```

на:

```tsx
  return (
    <UpdaterProvider value={update}>
    <div className="flex h-screen flex-col bg-background text-foreground">
```

и закрывающий `</div>` в самом конце `return` (последний, перед `);`) — на:

```tsx
    </div>
    </UpdaterProvider>
  );
```

- [ ] **Step 3: Прокинуть пропсы в `Titlebar` и `manual` в `UpdateToast`**

Заменить строку `<Titlebar onOpenSettings={() => setSettingsOpen(true)} />` на:

```tsx
      <Titlebar
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckForUpdates={update.recheck}
        updatePhase={update.phase}
        updateAvailable={update.hasUpdate}
      />
```

Заменить блок `<UpdateToast … />` на (добавлен `manual`):

```tsx
      <UpdateToast
        phase={update.phase}
        version={update.version}
        progress={update.progress}
        manual={update.manual}
        onUpdate={update.install}
        onDismiss={update.dismiss}
      />
```

- [ ] **Step 4: Типы + фокусный тест WorkflowApp**

Run: `pnpm lint`
Expected: нет ошибок TypeScript.

Run: `pnpm vitest run src/app/WorkflowApp.test.tsx`
Expected: PASS — существующие тесты (включая update-banner) зелёные; провайдер внутренний, churn нет.

- [ ] **Step 5: Полный прогон + commit**

Run: `pnpm test`
Expected: все тесты зелёные (база ~614 + новые из Tasks 1–5).

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(updater): wire UpdaterProvider + titlebar check button into WorkflowApp"
```

---

## Done / follow-ups

Когда все 6 задач закоммичены, `pnpm test` + `pnpm lint` зелёные — фича code-complete. Ручная проверка вживую (vite HMR): иконка в тайтлбаре крутится при проверке, тост показывает результат, «Later» оставляет бейдж, повторный клик возвращает тост; в Settings → About кнопка зовёт ту же проверку. Затем обновить строку «Active work» в `CLAUDE.md` и индекс памяти; при желании — `superpowers:requesting-code-review`.

**Вне scope (как в спеке):** периодические проверки по таймеру; рендер changelog в тосте; Apple notarization / Windows Authenticode.
