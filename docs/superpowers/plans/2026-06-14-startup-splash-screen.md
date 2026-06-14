# Startup Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать белую вспышку при холодном старте, заменив её брендированным тёмным сплэшем (логотип H-Bridge + вордмарк + пульс), который мгновенно гаснет по готовности React-оболочки.

**Architecture:** Один слой — `backgroundColor: "#0A0A0A"` на окне (Tauri красит и нативное окно, и webview ещё до парсинга HTML). Второй слой — самодостаточный инлайн-оверлей `#splash` прямо в `index.html` (рисуется до JS/CSS-бандла), который по маунту оболочки гаснет (CSS-fade) и удаляется из DOM. Без второго окна, без IPC; Rust не трогаем (только два JSON-конфига).

**Tech Stack:** Tauri 2.11 (window config), React 18 (`useEffect`-дисмисс), Vite (`index.html`), Vitest (jsdom-юниты).

**Статус:** 📝 PLAN (готов к исполнению; брейншторм-апрув + спека-ревизия получены 2026-06-14)
**Ветка:** `claude/zealous-bardeen-f306e5`
**Спека:** `docs/superpowers/specs/2026-06-14-startup-splash-screen-design.md`

---

## File Structure

| Файл | Ответственность |
| --- | --- |
| `src-tauri/tauri.conf.json` | `backgroundColor` окна `main` (Win/Linux + база) |
| `src-tauri/tauri.macos.conf.json` | `backgroundColor` окна `main` (mac override — RFC7396 заменяет массив целиком) |
| `src/features/shell/tauri-config-parity.test.ts` | guard синхронности конфигов — добавить `backgroundColor` |
| `index.html` | инлайн-оверлей `#splash` (H-Bridge SVG + вордмарк) + `<style>` + safety-`<script>` |
| `src/features/shell/splash.ts` | **новый** — pure `splashFadeMs` + DOM-раннер `dismissSplash` |
| `src/features/shell/splash.test.ts` | **новый** — юниты `splashFadeMs` + jsdom-тесты `dismissSplash` |
| `src/features/shell/splash-html.test.ts` | **новый** — guard: `index.html` содержит оверлей/safety/system-font |
| `src/app/WorkflowApp.tsx` | `useEffect(() => { dismissSplash(); }, [])` — снять оверлей по маунту |

Бэкенд-логика (Rust `lib.rs`/IPC) и `src/ipc/bindings.ts` — **не трогаем** (новых IPC нет).

---

## Task 1: Тёмный фон окна (убирает белую вспышку на уровне окна+webview)

**Files:**
- Modify: `src/features/shell/tauri-config-parity.test.ts`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/tauri.macos.conf.json`

- [ ] **Step 1: Расширить parity-тест — ждём `backgroundColor` в обоих конфигах**

Заменить весь файл `src/features/shell/tauri-config-parity.test.ts` на:

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
      "backgroundColor",
    ];
    for (const k of keys) {
      expect(macWin[k]).toEqual(baseWin[k]);
    }
  });
});

describe("tauri.conf.json window background", () => {
  // A dark window+webview background kills the white startup flash before the
  // dark frontend paints (Tauri backgroundColor covers both layers).
  it("sets a dark window background on both configs", () => {
    expect(baseWin.backgroundColor).toBe("#0A0A0A");
    expect(macWin.backgroundColor).toBe("#0A0A0A");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/shell/tauri-config-parity.test.ts`
Expected: FAIL — `backgroundColor` ещё нет (`expected undefined to be "#0A0A0A"`).

- [ ] **Step 3: Добавить `backgroundColor` в базовый конфиг**

В `src-tauri/tauri.conf.json` в объекте окна заменить:

```json
        "dragDropEnabled": false
```

на:

```json
        "dragDropEnabled": false,
        "backgroundColor": "#0A0A0A"
```

- [ ] **Step 4: Добавить `backgroundColor` в mac-override**

В `src-tauri/tauri.macos.conf.json` в объекте окна заменить:

```json
        "dragDropEnabled": false,
```

на:

```json
        "dragDropEnabled": false,
        "backgroundColor": "#0A0A0A",
```

(порядок полей не важен; `trafficLightPosition` остаётся последним.)

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/features/shell/tauri-config-parity.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/tauri.macos.conf.json src/features/shell/tauri-config-parity.test.ts
git commit -m "feat(splash): dark window background to kill startup white flash"
```

---

## Task 2: Модуль `splash.ts` — `splashFadeMs` + `dismissSplash`

**Files:**
- Create: `src/features/shell/splash.ts`
- Create: `src/features/shell/splash.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `src/features/shell/splash.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splashFadeMs, dismissSplash } from "./splash";

beforeEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { __splashKill?: number }).__splashKill;
  // jsdom не реализует matchMedia — мок по умолчанию: reduced-motion выключен.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

function mountSplash(): HTMLElement {
  const el = document.createElement("div");
  el.id = "splash";
  document.body.appendChild(el);
  return el;
}

describe("splashFadeMs", () => {
  it("is 0 under reduced motion, else the fade duration", () => {
    expect(splashFadeMs(true)).toBe(0);
    expect(splashFadeMs(false)).toBe(200);
    expect(splashFadeMs(false, 300)).toBe(300);
  });
});

describe("dismissSplash", () => {
  it("adds .is-hiding then removes #splash after the fade", () => {
    vi.useFakeTimers();
    mountSplash();
    dismissSplash();
    expect(document.getElementById("splash")?.classList.contains("is-hiding")).toBe(true);
    expect(document.getElementById("splash")).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(document.getElementById("splash")).toBeNull();
  });

  it("removes immediately under reduced motion (fade 0)", () => {
    vi.useFakeTimers();
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    mountSplash();
    dismissSplash();
    vi.runAllTimers();
    expect(document.getElementById("splash")).toBeNull();
  });

  it("is a no-op when #splash is absent", () => {
    expect(() => dismissSplash()).not.toThrow();
  });

  it("clears the safety timeout once the overlay is removed", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, "clearTimeout");
    (window as unknown as { __splashKill?: number }).__splashKill = 123;
    mountSplash();
    dismissSplash();
    vi.advanceTimersByTime(200);
    expect(clearSpy).toHaveBeenCalledWith(123);
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `pnpm test src/features/shell/splash.test.ts`
Expected: FAIL — `Failed to resolve import "./splash"` (модуля ещё нет).

- [ ] **Step 3: Реализовать `splash.ts`**

Создать `src/features/shell/splash.ts`:

```ts
/** Длительность fade-out оверлея; под reduced-motion — мгновенно (0). Pure. */
export function splashFadeMs(reducedMotion: boolean, fadeMs = 200): number {
  return reducedMotion ? 0 : fadeMs;
}

/** Снять стартовый оверлей `#splash`: добавить `.is-hiding` (CSS-fade) → удалить
 *  из DOM. Идемпотентно: если оверлея уже нет (safety-таймаут отработал или это
 *  повторный вызов под StrictMode) — no-op. Под reduced-motion fade = 0. */
export function dismissSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const fade = splashFadeMs(reduced);
  el.classList.add("is-hiding");
  window.setTimeout(() => {
    el.parentNode?.removeChild(el);
    const kill = (window as Window & { __splashKill?: number }).__splashKill;
    if (kill !== undefined) window.clearTimeout(kill);
  }, fade);
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `pnpm test src/features/shell/splash.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/splash.ts src/features/shell/splash.test.ts
git commit -m "feat(splash): splashFadeMs + dismissSplash overlay remover"
```

---

## Task 3: Инлайн-оверлей `#splash` в `index.html`

**Files:**
- Create: `src/features/shell/splash-html.test.ts`
- Modify: `index.html`

- [ ] **Step 1: Написать падающий guard-тест на `index.html`**

Создать `src/features/shell/splash-html.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// vitest runs with the repo root as cwd.
const html = readFileSync("index.html", "utf8");

describe("index.html startup splash", () => {
  it("ships an inline #splash overlay on a dark background", () => {
    expect(html).toContain('id="splash"');
    expect(html).toContain("#0A0A0A");
  });

  it("has a safety timeout that removes the overlay if the bundle never boots", () => {
    expect(html).toContain("__splashKill");
  });

  it("renders the wordmark in a system font (no Inter FOUT before the bundle)", () => {
    expect(html).toContain("Handshaker");
    expect(html).toContain("system-ui");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm test src/features/shell/splash-html.test.ts`
Expected: FAIL — в `index.html` ещё нет оверлея/`__splashKill`/`system-ui`.

- [ ] **Step 3: Заменить `index.html` целиком**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Handshaker</title>
    <style>
      #splash {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: #0A0A0A;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 1;
        transition: opacity 200ms ease;
      }
      #splash.is-hiding {
        opacity: 0;
      }
      #splash svg {
        animation: hs-breathe 1.8s ease-in-out infinite;
      }
      #splash .splash-word {
        margin-top: 18px;
        font: 600 21px system-ui, -apple-system, "Segoe UI", sans-serif;
        letter-spacing: -0.02em;
        color: #FAFAFA;
      }
      @keyframes hs-breathe {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @media (prefers-reduced-motion: reduce) {
        #splash { transition: none; }
      }
    </style>
  </head>
  <body class="bg-background text-foreground antialiased">
    <div id="root"></div>
    <div id="splash" aria-hidden="true">
      <svg width="92" height="92" viewBox="40 40 120 120" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hs-mono" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFFFFF" />
            <stop offset="1" stop-color="#C9CFD9" />
          </linearGradient>
        </defs>
        <g fill="url(#hs-mono)">
          <rect x="51" y="50" width="26" height="100" rx="13" />
          <rect x="123" y="50" width="26" height="100" rx="13" />
          <rect x="64" y="88" width="34" height="24" rx="7" />
          <rect x="102" y="88" width="34" height="24" rx="7" />
        </g>
      </svg>
      <div class="splash-word">Handshaker</div>
    </div>
    <script>
      window.__splashKill = setTimeout(function () {
        var el = document.getElementById("splash");
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 8000);
    </script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(H-Bridge mark — те же 4 прямоугольника и `mono`-градиент, что в `src-tauri/app-icon-windows.svg`.)

- [ ] **Step 4: Запустить guard-тест + сборку**

Run: `pnpm test src/features/shell/splash-html.test.ts`
Expected: PASS (3 теста).

Run: `pnpm build`
Expected: `tsc -b` + `vite build` без ошибок (Vite обрабатывает новый `index.html`).

- [ ] **Step 5: Commit**

```bash
git add index.html src/features/shell/splash-html.test.ts
git commit -m "feat(splash): branded startup overlay in index.html"
```

---

## Task 4: Снять оверлей по маунту React-оболочки

**Files:**
- Modify: `src/app/WorkflowApp.tsx`

Обоснование: `dismissSplash` уже покрыт юнит-тестами (Task 2); здесь — тонкая привязка (один `useEffect` на маунте, зеркалит существующий `useUiZoom()`-паттерн). Верификация — `tsc` + полный прогон vitest + live-проход.

- [ ] **Step 1: Импортировать `dismissSplash`**

В `src/app/WorkflowApp.tsx` после строки

```ts
import { useUiZoom } from "@/features/shell/zoom";
```

добавить:

```ts
import { dismissSplash } from "@/features/shell/splash";
```

- [ ] **Step 2: Снять сплэш по маунту**

В `src/app/WorkflowApp.tsx` сразу после

```ts
  // Зум UI: персистентный prefs.zoom → webview.setZoom + хоткеи Ctrl+=/-/0.
  useUiZoom();
```

добавить:

```ts
  // Снять стартовый оверлей #splash, как только оболочка смонтирована (маунт корня
  // = первый осмысленный кадр). Дисмисс через CSS-fade; идемпотентно (см. splash.ts).
  useEffect(() => {
    dismissSplash();
  }, []);
```

(`useEffect` уже импортирован в файле — строка 1.)

- [ ] **Step 3: Проверить типы**

Run: `pnpm lint`
Expected: `tsc -b` без ошибок.

- [ ] **Step 4: Полный прогон тестов**

Run: `pnpm test`
Expected: PASS — весь сьют зелёный (включая новые splash-тесты; старые не сломаны).

- [ ] **Step 5: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(splash): dismiss splash on app shell mount"
```

---

## Финальный гейт и live-проход

- [ ] **Гейт:** `pnpm test` (vitest) · `pnpm lint` (tsc) · `pnpm build` — всё зелёное.
- [ ] **Сборка приложения** (свежий worktree — сперва `pnpm install`, затем `dist/` уже собран `pnpm build` выше; `generate_context!` требует `dist/`): `pnpm tauri build` (или `pnpm tauri dev`) собирается без ошибок (валидирует, что Tauri принимает `backgroundColor`).
- [ ] **Live WebView2 (dev + release):**
  - Холодный старт — **нет белой вспышки**; сразу тёмный экран.
  - Сплэш: лого H-Bridge пульсирует, вордмарк «Handshaker» читается на `#0A0A0A`.
  - По готовности оболочки — плавный fade ~200мс и исчезновение; **на быстрой загрузке не должно быть резкого мелькания** (фон тёмный на всех этапах).
  - `prefers-reduced-motion` (вкл. в ОС) → fade мгновенный, пульс жив.
- [ ] **macOS:** отдельный проход (mac-конфиг с `backgroundColor`; нативный titlebar Overlay не конфликтует с оверлеем).

## Архивирование (после DONE)

Когда фича доведена и влита: `git mv` план → `docs/superpowers/plans/archive/`, спеку → `docs/superpowers/specs/archive/` одним коммитом `docs(archive): startup splash plan+spec`; обновить строку «Active work» в `CLAUDE.md` и индекс памяти.

---

## Self-Review

- **Покрытие спеки:** фон окна (Task 1) · оверлей в `index.html` + system-font вордмарк + safety-таймаут (Task 3) · `splashFadeMs`/`dismissSplash` + reduced-motion + идемпотентность (Task 2) · привязка по маунту (Task 4) · отказ от min-time (нигде не вводится — дисмисс сразу) · `backgroundColor` в обоих конфигах + guard (Task 1). Non-goals (второе окно/IPC/гейт по каталогу/light-mode) не реализуются — соответствует.
- **Плейсхолдеры:** нет — весь код и команды приведены полностью.
- **Согласованность типов/имён:** `dismissSplash()` (без аргументов) и `splashFadeMs(reducedMotion, fadeMs?)` одинаковы в `splash.ts`, тестах и вызове в `WorkflowApp`. `#splash` / `.is-hiding` / `__splashKill` / `#0A0A0A` / `system-ui` совпадают между `index.html`, `splash.ts` и guard-тестом. `backgroundColor: "#0A0A0A"` идентичен в обоих конфигах и parity-тесте.
