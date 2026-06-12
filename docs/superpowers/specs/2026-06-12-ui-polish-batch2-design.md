# UI polish batch #2 — дизайн

**Дата:** 2026-06-12 · **Статус:** утверждён устно, ждёт ревью спеки

Шесть независимых пунктов полиша: зум UI, dark-only, quick-add метода в коллекцию,
дублирование сохранённого запроса, баг гост-текста после Reset, восстановление
последнего response при переключении методов.

---

## 1. Масштаб UI — хоткеи + Settings

**Механизм.** `getCurrentWebview().setZoom(prefs.zoom)` (`@tauri-apps/api/webview`).
Заготовка уже есть: `prefs.zoom` + `clampZoom` (0.5–3.0, шаг 0.1) в
`src/lib/use-prefs.ts`, пермишен `core:webview:allow-set-webview-zoom` в
`src-tauri/capabilities/default.json`. Нативные зум-хоткеи WebView2 в Tauri
выключены по умолчанию (`zoomHotkeysEnabled: false`) — конфликтов нет.
Применение — best-effort (try/catch): вне Tauri (vitest/preview) молча no-op.

**Новый модуль** `src/features/shell/zoom.ts`:
- `applyZoom(factor): Promise<void>` — clamp + setZoom, no-throw;
- `zoomStepFromKey(e): "in" | "out" | "reset" | null` — чистый маппинг
  KeyboardEvent → действие (тестируемый без DOM).

**Применение при старте:** в `main.tsx` после чтения prefs — `void applyZoom(initial.zoom)`.
**Применение при изменении:** хук `useZoomHotkeys()` в корне приложения
(WorkflowApp): window keydown (capture, `preventDefault`), реагирует на:
- `Ctrl` + `=` / `+` / NumPad `+` → zoom + 0.1;
- `Ctrl` + `-` / NumPad `-` → zoom − 0.1;
- `Ctrl` + `0` / NumPad `0` → сброс к 1.0.

Каждое действие: `setPref("zoom", clampZoom(next))` + `applyZoom`. Capture-фаза,
чтобы фокус в Monaco не съедал хоткей. Ctrl+колесо мыши — **вне скоупа** (решение
пользователя).

**Settings → Appearance**, новая строка **Zoom** (группа Theme):
`[−] 100% [+]` (степпер, шаг 10%, disabled на границах) + кнопка Reset,
видимая только при значении ≠ 100%. Значение — `Math.round(zoom*100)%`.

## 2. Dark-only: убрать переключатель темы

Решение пользователя: жёстко dark-only, `prefs.theme` выпиливается.

- `Titlebar.tsx` — удалить кнопку Sun/Moon (+ импорты иконок), поправить
  `Titlebar.test.tsx` (строка «sidebar/theme/settings utilities»).
- `AppearancePane.tsx` — удалить строку «Mode».
- `use-prefs.ts` — удалить `theme` из `Prefs`/`PREFS_DEFAULTS` и тип `ThemeMode`.
  Миграция localStorage не нужна: лишний ключ `theme` в сохранённом JSON
  безвреден (Partial-merge его просто проносит мимо типа), ничего не читает его.
- `main.tsx` — безусловный `document.documentElement.classList.add("dark")`.
- `lib/monaco.ts` — удалить `monacoThemeFor`/`handshaker-light`/`ThemeMode`;
  `BodyView.tsx` всегда `"handshaker-dark"`.
- `components/ui/sonner.tsx` — `theme="dark"` литералом.
- Light-набор CSS-переменных в `globals.css`: `:root`-блок остаётся (это дефолты,
  на которых сидит `.dark`-override) — НЕ трогать; удалить только если есть
  отдельный явный light-блок.
- Тест-моки `usePrefs`, прокидывающие `theme: "dark"` — почистить по месту.

## 3. Quick-add метода в коллекцию (MethodPicker)

На строке метода в dropdown — hover-кнопка **«+»** (иконка Plus, справа рядом с
KindDot; видимость как у ⋯ в сайдбаре: `opacity-0 group-hover:opacity-100`).
Один клик — авто-сохранение без диалога (решение пользователя):

- **Цель** — по `suggestSaveTarget` (`grouping.ts`): первая коллекция дерева
  (если коллекций нет — создать «My Collection»); корневая папка с именем
  сервиса — переиспользовать существующую по имени или создать; имя запроса =
  короткое имя метода.
- **Содержимое** `SavedRequestIpc`: `address_template`/`tls_override` из текущего
  черновика, `body_template` = `EMPTY_BODY_TEMPLATE`, `metadata: []`,
  `auth: none`.
- **Дедуп:** если `findSavedLocations` уже находит этот service+method+address —
  не создавать дубль, а **открыть существующий** сохранённый запрос;
  тост `Уже в коллекции «…»`.
- **После сохранения — сразу переключиться на созданный запрос** (решение
  пользователя): открыть его как из сайдбара (`openSavedRequest` →
  origin-bound черновик), dropdown закрывается; тост
  `Сохранено в Collection / Folder`. Текущий черновик при этом origin-bound
  (автосейв) либо заменяется через стандартный discard-guard, если он dirty
  и не привязан.

Реализация: чистая `planQuickAdd(tree, service, method, address)` →
`{ kind: "exists", location } | { kind: "create", needCollection, folderName, … }`
(+ vitest); исполнение через существующие мутации `useCatalog`
(`createCollection`/`addItem`). `MethodPicker` получает опциональный проп
`onQuickAdd?: (svc, mth) => void` — кнопка рендерится только когда проп передан
(передаёт его только `DraftAddressBar`-контекст).

## 4. Кнопка Duplicate текущего сохранённого запроса

В хедере FocusView (строка брэдкрамба), только при `draftOrigin != null`,
рядом со статусом «Сохранено» — ghost-иконка **Copy** (tooltip «Duplicate
request»). Клик:

1. `duplicateItem(collectionId, requestId)` (существующая мутация; бэкенд
   deep-copy);
2. определить id созданной копии: если IPC `collection_duplicate_item` не
   возвращает id — найти диффом дерева до/после (новый id рядом с оригиналом);
   предпочтительно расширить IPC до возврата id (решится в плане по факту
   осмотра бэкенда);
3. открыть копию тем же путём, что клик в сайдбаре (`openSavedRequest`) —
   origin-bound черновик автосейвится, discard-guard не мешает;
4. тост `Duplicated as "…"`.

## 5. Баг: гост-скелет не исчезает после «Reset to template»

Симптом: ↺ Reset заполняет body полным скелетом, но ghost-зона с «недостающими»
полями остаётся видимой. Гипотеза: пересчёт ghost-блока подписан на
пользовательские правки редактора и не срабатывает на внешнее обновление
контролируемого `value` (через `executeEdits`). Чинится через
systematic-debugging (сначала воспроизводящий тест, потом фикс); фикс ожидаемо —
пересчитывать ghost на ЛЮБОЕ изменение модели. Регрессионный vitest обязателен.

## 6. Последний response сессии при переключении методов

Симптом: открыл другой сохранённый запрос (или сменил метод) → панель Response
пустая, хотя вызов в этой сессии уже выполнялся.

Источник истины — уже существующая история воркфлоу
(`commitExecutedStep` хранит снапшоты всех завершённых вызовов: ok + gRPC-error;
client-error/cancelled/unresolved не записываются — и не восстанавливаются).

Новая чистая функция `lastExecutedFor(steps, { service, method, address })` →
последний (по порядку добавления) совпадающий executed-шаг или `null`.
Подключение:

- **`openSavedRequest`** (`catalog/actions.ts`): сидировать новый драфт
  `outcome`/`status`/`error` из найденного шага.
- **`applyMethodSelection`** (`workflow/actions.ts`): патч включает
  response-поля из lookup; `null` → очистка (заодно убирает stale-ответ чужого
  метода, который сейчас остаётся висеть).

Session-only по построению (история in-memory). Streaming-фреймы вне скоупа.

---

## Тестирование и гейт

- Чистые функции (`zoomStepFromKey`, `planQuickAdd`, `lastExecutedFor`,
  ghost-регрессия) — vitest, TDD.
- Компонентные правки (Titlebar, AppearancePane, MethodPicker «+», FocusView
  Duplicate) — обновление/дополнение существующих тестов.
- Гейт: tsc clean · vitest · cargo test (core+app) · build.
- Живая проверка в WebView2: зум (хоткеи + Settings + рестарт), quick-add,
  duplicate, ghost после Reset, response после переключения.

## Вне скоупа

- Ctrl+колесо для зума; зум в нативных меню/тайтлбаре ОС.
- Возврат светлой темы (выпиливается совсем).
- Quick-add с выбором места (Alt+клик → диалог) — не делаем.
- Восстановление streaming-фреймов в Response.
