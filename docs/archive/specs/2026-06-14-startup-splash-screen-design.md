# Стартовый сплэш — убрать белую вспышку при холодном старте

**Статус:** 🎉 DONE 2026-06-14 — реализовано, влито в `main` ff `f9629d5`, live-verified.
**Ветка:** `claude/zealous-bardeen-f306e5`
**Дата:** 2026-06-14

## Цель

Убрать белый экран («cold-start flash») при запуске приложения и заменить его
брендированным **тёмным сплэшем** — логотип H-Bridge + вордмарк «Handshaker» с
мягким пульсом, консистентно с dark-only-приложением.

### Причина белой вспышки (диагностика)

1. Окно создаётся сразу видимым и **без цвета фона** (`src-tauri/tauri.conf.json`).
   Пока WebView2 не отрисует страницу, ОС показывает белый прямоугольник, а у
   самого WebView2 на Windows дефолтный фон — белый.
2. Тёмный фон приложения (`--background: 0 0% 3.9%` ≈ `#0A0A0A`) применяется только
   **после** загрузки CSS-бандла и монтирования React.
3. Зависания нет: Rust-`setup()` дешёвый и синхронный (читает state с диска, без
   сети), каталог грузится асинхронно и первый рендер не блокирует. Значит это
   **короткая вспышка**, а не долгая загрузка.

## Архитектура — встроенный оверлей (одно окно)

Выбрана из двух вариантов (второй — отдельное окно `splashscreen` + IPC из офиц.
гайда — отклонён: больше движущихся частей, оправдан только при тяжёлой инициализации
бэкенда, которой у нас нет). Решение — **два слоя**, закрывающих оба источника белого:

### Слой 1 — фон окна и webview (до парсинга HTML)

`backgroundColor: "#0A0A0A"` на окне `main`. В Tauri 2 это свойство `WindowConfig`
задаёт фон **и нативного окна, и самого webview** (формат — hex-строка, поддержка
с 2.0; у нас 2.11). Так белого нет ни на одном слое **ещё до** того, как
распарсится HTML. Без этого даже идеальный оверлей мигнёт белым в первые мс.

### Слой 2 — инлайн-оверлей в `index.html` (до загрузки JS/CSS-бандла)

Разметка сплэша + его `<style>` живут **прямо в `index.html`**, самодостаточно
(литеральные цвета, без зависимости от Tailwind-бандла). Рисуется в момент парсинга
HTML — **до** загрузки `main.tsx` / Monaco / шрифтов. React монтируется → по маунту
оболочки оверлей плавно гаснет и удаляется из DOM.

Бэкенд (Rust) почти не трогаем — только два JSON-конфига. Новых IPC нет →
`src/ipc/bindings.ts` не регенерим.

## Внешний вид

- **Фон:** `#0A0A0A` (= `--background` dark).
- **Лого:** H-Bridge mark — 4 скруглённых прямоугольника, **переиспользуем из
  `src-tauri/app-icon-windows.svg`** (тот же `mono`-градиент `#FFFFFF → #C9CFD9`),
  размер ~92px. Центр композиции.
- **Вордмарк:** «Handshaker» под лого. **System-font-стек**
  (`system-ui, -apple-system, "Segoe UI", sans-serif`), **не Inter** — Inter
  грузится из бандла, которого на момент сплэша ещё нет; system-шрифт убирает
  FOUT-свап. ~21px, weight 600, `letter-spacing: -0.02em`, цвет `#FAFAFA`
  (= `--foreground`). Бренд несёт в основном **лого**, вордмарк в system-шрифте на
  ~0.5с — приемлемо.
- **Анимация:** мягкий «пульс» лого — `@keyframes` opacity `1 ↔ 0.4`, ~1.8s
  `ease-in-out infinite`. Спиннер/статика отклонены при апруве мокапа.

## Поведение и жизненный цикл

- `index.html` инлайн-`<script>` (ДО module-скрипта) ставит **safety-таймаут**
  (`SAFETY_MS = 8000`), который форс-удаляет `#splash`, если фронт его не снял —
  чтобы сломанный/незагрузившийся бандл не оставил мёртвый сплэш навсегда.
- React монтируется; дисмисс вызывается **после первого коммита оболочки** —
  `useEffect(() => { dismissSplash(); }, [])` в корне `WorkflowApp` (маунт корня =
  «оболочка готова»).
- **Без форсированного минимума показа.** Снимаем сплэш **сразу по готовности**:
  класс `.is-hiding` (opacity→0, transition `FADE_MS = 200`) → после fade удалить
  ноду + снять safety-таймаут. Best practice: при ожидании < 1с индикатор не нужен,
  а имитировать задержку — анти-паттерн (NN/g; см. Sources). Быстрый старт →
  быстрый уход. «Мелькания» нет by design: фон стабильно `#0A0A0A` на всех этапах
  (dark-only + `backgroundColor`), меняется только лого, которое мягко гаснет.
- **`prefers-reduced-motion`:** fade мгновенный (`FADE_MS → 0`). Пульс **остаётся**
  живым — это уже принятая политика приложения (спиннер/пульс не глушатся
  reduced-motion; см. `globals.css`).
- **Идемпотентность:** повторный вызов (StrictMode dev double-invoke, гонка с
  safety) безопасен — если `#splash` уже нет, `dismissSplash` — no-op.
- **Сигнал «готово» = маунт оболочки React**, НЕ загрузка каталога: у каталога
  свой `loading`-UI (`useCatalogTree`), ждать его незачем (см. Non-goals).
- **Если** живьём на тёплом старте лого всё же мигнёт — добавить **маленький**
  порог (~250мс) перед дисмиссом; по умолчанию его нет.

## Архитектура кода

Чистая логика — в отдельном тестируемом модуле; DOM-раннер тонкий. Зеркалит
существующую дисциплину репо (`cycle.ts`/`reorder.ts` — pure + тонкий хэндлер).

### Новый модуль `src/features/shell/splash.ts`

```ts
/** Длительность fade-out; под reduced-motion — мгновенно. Pure. */
export function splashFadeMs(reducedMotion: boolean, fadeMs = 200): number {
  return reducedMotion ? 0 : fadeMs;
}

/** Снять стартовый оверлей сразу по готовности: fade → удалить. Идемпотентно. */
export function dismissSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return; // уже снят (safety/повторный вызов) → no-op
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

### `index.html` (фрагмент)

```html
<body class="bg-background text-foreground antialiased">
  <div id="root"></div>
  <div id="splash" aria-hidden="true">
    <svg viewBox="40 40 120 120" width="92" height="92"> … H-Bridge mark + mono-градиент … </svg>
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
```

Инлайн-`<style>` (в `<head>`): `#splash{position:fixed;inset:0;z-index:9999;
background:#0A0A0A;display:flex;flex-direction:column;align-items:center;
justify-content:center;opacity:1;transition:opacity 200ms ease}`,
`#splash.is-hiding{opacity:0}`, `#splash svg{animation:hs-breathe 1.8s ease-in-out
infinite}`, `.splash-word{margin-top:18px;font:600 21px system-ui,-apple-system,
"Segoe UI",sans-serif;letter-spacing:-.02em;color:#FAFAFA}`,
`@keyframes hs-breathe{0%,100%{opacity:1}50%{opacity:.4}}`,
`@media (prefers-reduced-motion:reduce){#splash{transition:none}}`.

### Привязка в `src/app/WorkflowApp.tsx`

```ts
useEffect(() => { dismissSplash(); }, []);
```

## Тестирование

**Юнит (`src/features/shell/splash.test.ts`):**
- `splashFadeMs`: `(true)→0`; `(false)→200`; кастомный `fadeMs`.
- `dismissSplash` (jsdom, `vi.useFakeTimers` + мок `window.matchMedia`):
  вставить `#splash`; вызвать → сразу класс `.is-hiding`; прокрутить таймеры на
  `FADE_MS` → нода удалена. Reduced-motion (matchMedia `matches:true`) → fade 0мс,
  нода удаляется без ожидания transition. Повторный вызов при отсутствии `#splash`
  → не бросает (no-op).

**Live-проход** (после имплементации, WebView2): см. ниже.

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `src-tauri/tauri.conf.json` | `"backgroundColor": "#0A0A0A"` на окне `main` |
| `src-tauri/tauri.macos.conf.json` | то же — override **заменяет** массив `windows` целиком (RFC7396), поэтому фон нужно продублировать |
| `index.html` | инлайн-оверлей `#splash` (H-Bridge SVG + вордмарк) + инлайн-`<style>` + `<script>` (start-time + safety-таймаут) |
| `src/features/shell/splash.ts` | **новый** — pure `splashFadeMs` + DOM-раннер `dismissSplash` |
| `src/features/shell/splash.test.ts` | **новый** — юнит pure-хелперов + jsdom-тест `dismissSplash` |
| `src/app/WorkflowApp.tsx` | `useEffect(() => dismissSplash(), [])` |

Бэкенд-логика (Rust `lib.rs`/IPC) и `bindings.ts` — **не трогаем**.

## Риски

| Риск | Митигация |
| --- | --- |
| Сломанный/незагрузившийся JS-бандл оставит сплэш навсегда | Safety-таймаут 8с в `index.html` форс-удаляет `#splash` независимо от фронта. |
| FOUT-свап вордмарка (Inter грузится позже) | Вордмарк на **system-font-стеке**, не Inter — свопа нет. |
| StrictMode dev: двойной вызов эффекта / гонка с safety | `dismissSplash` идемпотентен (нет `#splash` → no-op; `removeChild` через `parentNode?`). |
| `tauri.macos.conf.json` override теряет `backgroundColor` | Явно дублируем `backgroundColor` в mac-override (в таблице файлов). |
| На очень быстром (тёплом) старте лого мигнёт на ~100мс | Фон стабильно тёмный (нет белого скачка), дисмисс через fade ~200мс смягчает; форс-минимума **нет** (имитировать задержку — анти-паттерн по NN/g). Если живьём мешает — добавить порог ~250мс. |
| Цвет `#0A0A0A` чуть расходится с `--background` | `hsl(0 0% 3.9%)` = `rgb(9.9,9.9,9.9)` ≈ `#0A0A0A` (округление 10). Визуально идентично; оверлей всё равно перекрывает фон до маунта. |

## Non-goals

- Отдельное окно `splashscreen` + IPC-оркестрация (вариант 2) — отклонено.
- Гейтинг показа до загрузки каталога — нет, у каталога свой loading-UI.
- Light-mode-вариант сплэша — приложение dark-only.
- Спиннер / статичный лого — отклонены при апруве мокапа (выбран пульс).

## Live-проход (после имплементации)

В WebView2 (release-сборка; помни: `dist/` должен существовать до компиляции
`src-tauri`): холодный старт **без** белой вспышки; сплэш тёмный, лого пульсирует,
вордмарк читается; по готовности оболочки — плавный fade и исчезновение; при
`prefers-reduced-motion` fade мгновенный, пульс жив. Проверить и dev (`vite`), и
release. На macOS — отдельный проход (mac-конфиг с `backgroundColor`).

## Sources

- [Tauri v2 — Window config (`backgroundColor`: фон окна и webview)](https://v2.tauri.app/reference/config)
- [Tauri v2 — Splashscreen guide (вариант 2, отклонён)](https://v2.tauri.app/learn/splashscreen)
- [Tauri discussion #13226 — preventing the white flash on Windows](https://github.com/orgs/tauri-apps/discussions/13226)
- [NN/g — Response Time Limits (<1с не требует индикатора; не имитировать задержку)](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [OpenReplay — Loading indicators (delay-before-show; <200мс не показывать)](https://blog.openreplay.com/quick-guide-loading-indicators-web-apps/)
- [Appy Pie — App splash screen best practices (держать коротким, не фейкать)](https://www.appypie.com/blog/app-splash-screen-best-practices)
