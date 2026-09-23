# Дизайн: отдельный стиль титлбара для macOS

**Дата:** 2026-06-08
**Статус:** утверждён, готов к плану
**Ветка разработки:** (создать новую, напр. `feat/macos-titlebar`)

## Проблема

Окно Handshaker фреймлес на всех платформах (`decorations: false` в
[tauri.conf.json](../../../src-tauri/tauri.conf.json)), а
[Titlebar.tsx](../../../src/features/shell/Titlebar.tsx) рисует кастомные кнопки
окна (min/max/close) **справа** — это Windows-идиома. На macOS это выглядит
чужеродно: кнопки не на месте, нет нативного «светофора» (traffic lights) слева.
Нужен отдельный, идиоматичный стиль для macOS.

## Решения (зафиксированы на брейншторме)

1. **Нативный светофор через Overlay** — macOS рисует родные traffic lights
   слева, наш бар — оверлеем. Кастомный светофор НЕ перерисовываем (Apple HIG:
   системные кнопки дают бесплатно hover/zoom/accessibility/системную тему).
2. **Минималистичная компоновка** на macOS — без wordmark «Handshaker» (имя и так
   в macOS menu-bar).
3. **Плотный фон** (`bg-card`), без vibrancy/frosted-glass.

## Источники (проверено)

- Tauri 2 `TitleBarStyle::Overlay` / `Transparent` / `Visible`, `trafficLightPosition`
  (требует `Overlay` + `decorations: true`): docs v2 — *learn/window-customization*,
  *reference/config*.
- Platform-specific config `tauri.macos.conf.json` авто-мерджится поверх базового
  по **JSON Merge Patch (RFC 7396)**: docs v2 — *develop/configuration-files*,
  *reference/cli*. ⚠️ По RFC 7396 **массивы заменяются целиком** (не поэлементно).

## Архитектура — две точки ветвления

### (a) Конфиг окна (build-time, per-OS)

Базовый [tauri.conf.json](../../../src-tauri/tauri.conf.json) остаётся
Windows/Linux-дефолтом (`decorations: false`). Новый
`src-tauri/tauri.macos.conf.json` переопределяет окно на macOS-сборках:

```json
{
  "app": {
    "windows": [
      {
        "label": "main", "title": "Handshaker",
        "width": 1280, "height": 800, "minWidth": 1024, "minHeight": 600,
        "resizable": true, "fullscreen": false, "dragDropEnabled": false,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "trafficLightPosition": { "x": 14, "y": 11 }
      }
    ]
  }
}
```

Полный дубль объекта окна — вынужденный из-за array-replace в RFC 7396 (нельзя
переопределить только `decorations`/`titleBarStyle`, не повторив весь объект).
Геометрия окна теперь в двух местах — приемлемо, значения стабильны.

`trafficLightPosition` `{x:14, y:11}` центрирует светофор в баре высотой 36px
(`h-9`); значения тюнятся вручную на реальной машине.

**Альтернатива (отвергнута для старта):** строить окно в Rust `setup()` с
`#[cfg(target_os = "macos")]` — single-source геометрии, но императивно. Если
дублирование станет проблемой — мигрировать туда.

### (b) React-ветвление (рантайм)

Новый `src/lib/platform.ts`:

```ts
/** true на macOS. Синхронно (без async-флэша) — UA в WKWebView на macOS
 *  всегда содержит "Macintosh". Плагин @tauri-apps/plugin-os даёт platform()
 *  только асинхронно → моргание кнопок при первом рендере. */
export const isMacOS = navigator.userAgent.includes("Mac");
```

## Изменения в `Titlebar.tsx`

Один компонент, две ветки по `isMacOS`:

| Зона | Windows/Linux (как есть) | macOS |
|---|---|---|
| Левый инсет под светофор | нет | спейсер ~`w-[70px]` (схлопывается в fullscreen) |
| Лого (LogoMark) | есть | есть |
| Wordmark «Handshaker» | есть | **убрать** |
| Workflow selector + Env | есть | есть |
| Центр: ViewSwitcher | есть | есть |
| Справа: sidebar / тема / настройки | есть | есть |
| Справа: разделитель + min/max/close | есть | **убрать** (нативные слева) |

Фон — `bg-card` на всех ОС.

## Edge case — fullscreen

В fullscreen на macOS светофор прячется → левый инсет 70px надо убирать, иначе
пустая дыра слева. Небольшой хук `useIsFullscreen()`:
`getCurrentWindow().isFullscreen()` для начального значения + слушатель
fullscreen/resize-событий окна. Инсет рендерится только при `!fullscreen`.

## Тесты

[Titlebar.test.tsx](../../../src/features/shell/Titlebar.test.tsx) сейчас жёстко
проверяет наличие min/max/close ([:43](../../../src/features/shell/Titlebar.test.tsx)).
После ветвления:

- мок `@/lib/platform` (`isMacOS`) → два describe-блока:
  - **Windows/Linux:** кнопки окна есть, wordmark есть;
  - **macOS:** кнопок окна нет, wordmark нет, есть left-spacer; нативный светофор
    не в DOM (рисует ОС);
- общие проверки (workflow / env / ViewSwitcher / settings / drag-region) — для
  обеих веток.

## Вне scope (YAGNI)

- Кастомный светофор в React.
- Vibrancy / frosted-glass / прозрачность.
- Переключатель стиля титлбара в настройках.
- Отдельная Linux-специфика — Linux идёт по Windows-ветке (`decorations:false`),
  приемлемо.

## Файлы (ожидаемо затронуты)

- `src-tauri/tauri.macos.conf.json` — новый.
- `src/lib/platform.ts` — новый.
- `src/features/shell/Titlebar.tsx` — ветвление + хук fullscreen.
- `src/features/shell/Titlebar.test.tsx` — переработка под две платформы.
- (возможно) `src/lib/use-fullscreen.ts` — новый хук, если выносить.
