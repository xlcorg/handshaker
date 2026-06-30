# Command Palette — прибить к верху, убрать рост вверх-вниз (design)

> **Статус:** 🎉 DONE — реализовано; ребейз на `main` (`e2e1691`) + squash 4 коммитов в 1 + ff в
> `main`. Гейт зелёный, spec+quality ревью пройдены. **Live-verified в WebView2 (2026-06-30).**
> **Ветка:** `claude/priceless-pasteur-738467` (worktree).
> **Бэкенд/IPC/bindings:** не затрагиваются (чистый фронт, CSS-классы).
> **Гейт:** `vitest` **1175** · `tsc -b` · `vite build` — зелёные. `cargo`/bindings-no-drift не нужны.

## Проблема / цель

Командная палитра (`Ctrl/Cmd+K` / `Ctrl/Cmd+P`) живёт в общем `Dialog`, который
спозиционирован **по центру экрана по вертикали** — `top-[50%] left-[50%]
translate-x-[-50%] translate-y-[-50%]` ([dialog.tsx:62](../../../src/components/ui/dialog.tsx)).
По мере набора список результатов растёт (`max-h-[360px]`,
[command.tsx:46](../../../src/components/ui/command.tsx)), и из-за вертикального
центрирования высота прибавляется **в обе стороны**: верхний край ползёт вверх,
нижний — вниз. Поле ввода «прыгает» при каждом изменении числа результатов.

**Цель** — устранить рост вверх-вниз: палитра должна открываться в предсказуемой
точке у верхней части окна, поле ввода стоять неподвижно, а список расти **только
вниз** до предела и затем скроллиться. Это канонический паттерн command palette
(VS Code, Linear, Raycast, Superhuman, GitHub, Slack, Algolia DocSearch).

## Best practice (источники)

Канон: палитра прибита к верхней части вьюпорта (≈10–20% сверху), центрирована по
горизонтали, поле ввода на фиксированной позиции, результаты растут вниз и
скроллятся при переполнении. Вертикальное центрирование — антипаттерн для палитры
(рост от центра в обе стороны). Подтверждения:
[UX Patterns for Developers — Command Palette](https://uxpatterns.dev/patterns/advanced/command-palette),
[Superhuman — how to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/),
[Sam Solomon — Designing Command Palettes](https://solomon.io/designing-command-palettes/),
[Rob Dodson — Command palettes for the web](https://robdodson.me/posts/command-palettes/).

## Что уже есть в коде (база для реюза)

- `src/components/ui/dialog.tsx` — общий shadcn `Dialog`. `DialogContent` собирает
  классы через `cn(БАЗА, className)`, где `cn = twMerge(clsx(...))`
  ([cn.ts](../../../src/lib/cn.ts)). Базовая строка содержит центрирование
  `top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]`. **Этот файл общий
  для всех диалогов приложения — не трогаем.**
- `src/components/ui/command.tsx` — `CommandList` имеет базовый `max-h-[360px]`.
- `src/features/catalog/CommandPalette.tsx` — палитра. Её `DialogContent` уже
  получает локальный `className="overflow-hidden gap-0 p-0 sm:max-w-xl"`
  ([CommandPalette.tsx:199](../../../src/features/catalog/CommandPalette.tsx)).
  `CommandList` рендерится без своего `className`.

**Ключевой факт:** `cn` = `twMerge(clsx(...))`. При конфликте классов одной
утилитной группы twMerge оставляет **последний** (тот, что из `className`-аргумента,
т.е. из палитры). Группы `top-*`, `translate-y-*`, `max-h-*` — каждая одна группа,
поэтому override базовых значений из палитры срабатывает надёжно. Это не Slot/`asChild`
(там twMerge не применяется — [[project_radix_slot_no_twmerge]]); `DialogContent`
рендерит реальный `DialogPrimitive.Content` с `cn(...)`, так что override честный.

## Утверждённые решения

| # | Решение | Выбор |
|---|---------|-------|
| 1 | Куда прибить палитру | **К верху** (canonical). Поле ввода неподвижно, список растёт только вниз |
| 2 | Как реализовать | **Локальный override классов на палитре** (`CommandPalette.tsx`), общий `dialog.tsx` НЕ трогаем |
| 3 | Вертикальный якорь | `top-[12vh] translate-y-0` (переопределяет базовые `top-[50%]` / `translate-y-[-50%]`); горизонталь `left-[50%] translate-x-[-50%]` оставляем |
| 4 | Кап высоты списка | `max-h-[min(360px,60vh)]` на `CommandList` палитры (защита от выезда за нижний край на низком окне Tauri) |
| 5 | Рост от поля ввода | Список растёт **вниз** и скроллится на пределе; пустой резерв высоты НЕ вводим (на пустом вводе палитра компактна) |
| 6 | Общий `dialog.tsx` / другие диалоги | Без изменений (override только на палитре) |

## Архитектура и модули

### `CommandPalette.tsx` (единственная правка)

**(1) Вертикальный якорь.** К `DialogContent` добавить override-классы. Было:

```tsx
<DialogContent
  showCloseButton={false}
  className="overflow-hidden gap-0 p-0 sm:max-w-xl"
>
```

Станет:

```tsx
<DialogContent
  showCloseButton={false}
  className="top-[12vh] translate-y-0 overflow-hidden gap-0 p-0 sm:max-w-xl"
>
```

twMerge переопределит базовые `top-[50%]` → `top-[12vh]` и `translate-y-[-50%]`
→ `translate-y-0`. `left-[50%] translate-x-[-50%]` из базы остаются (горизонтальное
центрирование не трогаем).

**(2) Кап высоты списка.** `CommandList` палитры получает свой `className`:

```tsx
<CommandList className="max-h-[min(360px,60vh)]">
```

twMerge переопределит базовый `max-h-[360px]`. Список упирается в меньшее из
`360px` и `60vh` ⇒ на низком окне палитра не выезжает за нижний край; внутри списка —
скролл (базовый `overflow-y-auto` сохраняется).

### Незатронутое

- `src/components/ui/dialog.tsx` — без изменений (общий для всех диалогов).
- `src/components/ui/command.tsx` — без изменений (override на call-site палитры).
- Логика палитры: поиск/ранжирование (`paletteModel.ts`/`palette.ts`/`fuzzy.ts`),
  навигация cmdk, drill, хоткеи, футер, подсветка — без изменений.
- `messages.ts` — новых строк нет (правка чисто визуальная).
- Бэкенд / IPC / bindings — не трогаем.

## Состояние и поток

Меняется только **позиционирование контейнера** и **кап высоты списка**.
Поведение поиска, состояние `{ scope, query }`, навигация, открытие запроса/коллекции —
идентичны текущим.

После изменения:
- Палитра открывается у верхней части окна (≈12% сверху), по центру по горизонтали.
- Поле ввода стоит неподвижно при наборе и при любом числе результатов.
- Нижний край растёт вниз по мере появления строк, упирается в `min(360px,60vh)` и
  дальше список скроллится. Роста вверх нет.

## Тесты (TDD)

Изменение чисто-CSS, поэтому тест проверяет, что override-классы **реально попали на
DOM-узлы** (т.е. twMerge разрешил конфликт в нашу пользу). Рендер-тест в
`src/features/catalog/CommandPalette.test.tsx` (Radix-диалог рендерится в портал ⇒
запрос по `document`):

- Открыть палитру (`open`); найти контейнер `[data-slot="dialog-content"]`.
  - assert: `className` содержит `top-[12vh]` и `translate-y-0`;
  - assert: `className` **не** содержит `top-[50%]` и `translate-y-[-50%]`
    (доказывает, что override победил базу, а не просто добавился);
  - assert: `className` содержит `translate-x-[-50%]` (горизонталь цела).
- Найти `[data-slot="command-list"]`; assert: `className` содержит
  `max-h-[min(360px,60vh)]` и **не** содержит голый `max-h-[360px]`.

Существующие тесты палитры (поведение поиска/навигации) не должны регрессировать.

## Гейт

`pnpm test` (vitest) · `tsc -b` · `vite build`. Бэкенд не трогаем ⇒ `cargo` и
bindings-no-drift не требуются. Остаток после гейта — живой WebView2-проход.

## Вне scope (YAGNI / не выбрано)

- Извлечение отдельного `CommandDialog`-компонента (хватает override двух мест).
- Изменение общего `dialog.tsx` / поведения остальных диалогов.
- Резерв постоянной высоты на пустом вводе (выбран рост вниз, а не фикс-бокс).
- Настраиваемый отступ/высота через prefs (значения зашиты: `12vh`, `min(360px,60vh)`).
- Виртуализация списка, изменение логики поиска/ранжирования.

## Риски / на что смотреть

- **twMerge должен победить базу.** Если override не сработает (например, базовый
  класс изменят на не-конфликтующую форму), палитра останется центрированной. Тест на
  отсутствие `top-[50%]`/`translate-y-[-50%]` на узле это ловит.
- **Анимация входа.** База использует `data-[state=open]:zoom-in-95` (scale через
  CSS-переменные Tailwind). `translate-y-0` + `translate-x-[-50%]` композятся в тот же
  `transform`, как и в базовом диалоге (там `translate-y-[-50%]` + zoom) — регрессии
  анимации не ожидается.
- **Низкое окно.** Кап `min(360px,60vh)` + якорь `12vh` держат палитру в пределах
  вьюпорта; при очень низком окне список просто раньше уходит в скролл.
- **jsdom-портал.** `DialogContent` рендерится в портал — в тесте искать по
  `document`, не по `container` из `render` (как в существующих тестах палитры/диалогов).
