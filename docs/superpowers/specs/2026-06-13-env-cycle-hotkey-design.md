# Ctrl+E — циклическое переключение окружения

**Статус:** 📝 SPEC (брейншторм-апрув получен 2026-06-13; план ещё не написан)
**Ветка:** `claude/modest-sinoussi-a20e6e`
**Дата:** 2026-06-13

## Цель

Добавить глобальный хоткей **Ctrl+E** (и **Cmd+E** на macOS), который переключает
окружение активного воркфлоу на **следующее** по кругу. Раньше `Ctrl+E` открывал
дропдаун env-switcher'а (Master spec §9, жил в удалённом `src/App.tsx`); в
workflow-редизайне хоткей пропал, а пункт «Keyboard Ctrl+E» в Settings был
вычищен как нереализованный (см. `2026-06-13` Settings-чистка). Теперь
восстанавливаем функциональность, но в виде **цикла**, а не открытия меню.

## Поведение

- **Ctrl+E / Cmd+E** → активное окружение активного воркфлоу сменяется на
  **следующее** в пользовательском порядке списка (порядок = backend-`Vec`,
  тот же, что виден в меню), с **заворачиванием** в начало после последнего.
- **«No environment» исключён из цикла** — попасть в «нет окружения» можно только
  через меню, хоткеем — нельзя.
- Крайние случаи:
  - Активного env нет (`null`) + Ctrl+E → выбирается **первый** env списка.
  - Активный env — последний → заворот на **первый**.
  - **Ноль окружений** → no-op (ничего не происходит).
  - Имя активного env не найдено в списке (например, только что удалён) →
    трактуется как `null` → первый env.

## Раскладко-независимость (критично для этого пользователя)

Матчим по **`e.code === "KeyE"`** (физическая клавиша), **не** по `e.key`. На
русской ЙЦУКЕН-раскладке физическая клавиша E даёт `e.key === "у"`, но
`e.code` всегда `"KeyE"` — значит хоткей сработает при любой активной раскладке.
Это зеркалит уже принятую в `src/features/shell/zoom.ts` дисциплину: символы
(`=`/`-`) матчатся по `key` (раскладко-независимо для символов), а NumPad — по
`code`. Для **буквенного** хоткея единственно надёжный путь — `code`.

## Гард-условия (по образцу `useUiZoom`)

- **AltGr-гард:** `if (e.altKey) return` — на Windows AltGr = Ctrl+Alt и печатает
  символы (`€` и т.п.) на евро-раскладках; без гарда хоткей ложно срабатывал бы.
- Требуется `e.ctrlKey || e.metaKey`.
- Требуется **отсутствие Shift** (`!e.shiftKey`) — Ctrl+Shift+E не наш хоткей.
- Игнор автоповтора (`e.repeat`) — удержание клавиши не должно «строчить» по
  окружениям.
- `e.preventDefault()` при срабатывании.
- Слушатель в **capture-фазе** на `window` — чтобы сфокусированный Monaco-редактор
  не перехватил сочетание (та же причина, что у zoom-хука).

Хоткей **глобальный** (срабатывает независимо от фокуса) — это намеренно: смена
окружения — приложение-уровневое действие. Совпадает с исходным дизайном
(глобальный слушатель в `App.tsx`) и с поведением zoom-хука. Гарда на
«фокус в текстовом поле» нет (YAGNI; на Windows Ctrl+E в инпуте ничего штатно не
делает, а смена активного env под открытым диалогом безвредна).

## Архитектура

Чистая логика — в отдельном тестируемом модуле; тонкий обработчик — в компоненте.
Это зеркалит существующую пару `reorder.ts` (чистый `computeReorder`) + инлайн-DnD
в `WorkflowEnvControl`.

### Новый модуль `src/features/envs/cycle.ts`

```ts
/** Предикат хоткея «cycle env»: Ctrl/Cmd+E по физической клавише E
 *  (раскладко-независимо), без Alt (AltGr-гард) и без Shift. */
export function isEnvCycleHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (e.altKey || e.shiftKey) return false;     // AltGr печатает символы; Shift — не наш хоткей
  if (!e.ctrlKey && !e.metaKey) return false;
  return e.code === "KeyE";                      // физическая E — работает на ЙЦУКЕН/QWERTY
}

/** Следующее окружение по кругу (исключая «No environment»).
 *  Возвращает имя env для активации, либо null = no-op (список пуст). */
export function nextEnvName(names: string[], current: string | null): string | null {
  if (names.length === 0) return null;
  const idx = current === null ? -1 : names.indexOf(current);
  return names[(idx + 1) % names.length];       // idx === -1 (нет/не найдено) ⇒ первый
}
```

### Привязка в `WorkflowEnvControl`

`WorkflowEnvControl` уже владеет `envs` (грузит через `envList()`), активным env
(`wf.envName` из `useActiveWorkflow()`) и путём смены (`workflowStore.setWorkflowEnv`).
Добавляем `useEffect`, который вешает capture-фазовый `keydown`-слушатель,
перепривязываясь на `[envs, activeEnv]` (меняются редко):

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !isEnvCycleHotkey(e)) return;
    const next = nextEnvName(envs.map((x) => x.name), activeEnv);
    if (next === null) return;                   // ноль env — no-op, не глотаем клавишу
    e.preventDefault();
    workflowStore.setWorkflowEnv(next);
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}, [envs, activeEnv]);
```

`setWorkflowEnv` уже синкает backend (`envActiveSet`) и обновляет активный
воркфлоу — отдельной IPC-обвязки не нужно.

### Обнаруживаемость — подсказка в шапке меню

В `EnvSwitcherMenu` рядом с заголовком `ENVIRONMENTS` (в строке, где справа `+`)
добавляем маленький приглушённый keycap-хинт: `Ctrl+E` на Windows/Linux, `⌘E` на
macOS (через существующий `isMacOS` из `@/lib/platform`). Стиль — `text-[10px]
text-muted-foreground` под стать заголовку; `aria-hidden` (декоративно).

## Обратная связь

Лейбл env-pill в тайтлбаре (имя + цветная точка) обновляется мгновенно при смене —
этого достаточно. Тост не добавляем (YAGNI).

## Тестирование

**Юнит (`src/features/envs/cycle.test.ts`):**
- `nextEnvName`: пустой список → `null`; `current=null` → первый; средний →
  следующий; последний → заворот на первый; `current` не из списка → первый;
  один env → тот же.
- `isEnvCycleHotkey`: `{ctrlKey, code:"KeyE"}` → true; `+altKey` (AltGr) → false;
  `+shiftKey` → false; без ctrl/meta → false; `{metaKey, code:"KeyE"}` (mac) →
  true; кириллический ввод `{ctrlKey, code:"KeyE"}` (key был бы `"у"`) → true.

**Интеграция (`src/features/workflow/WorkflowEnvControl.test.tsx`):**
- Рендер контрола (мок `envList` → `[staging, prod]`, реальный `workflowStore`),
  диспатч `KeyboardEvent("keydown", {ctrlKey, code:"KeyE", bubbles})` на `window`;
  ждём перепривязки эффекта; ассерт `workflowStore.activeWorkflow().envName`
  циклится `null→staging→prod→staging`.
- AltGr (`{ctrlKey, altKey, code:"KeyE"}`) → env не меняется.

**Подсказка (в `EnvSwitcherMenu.test.tsx`):** меню открыто → виден текст
`Ctrl+E` (на тестовом не-mac UA).

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `src/features/envs/cycle.ts` | **новый** — `isEnvCycleHotkey` + `nextEnvName` |
| `src/features/envs/cycle.test.ts` | **новый** — юнит-тесты обеих функций |
| `src/features/workflow/WorkflowEnvControl.tsx` | `useEffect` с capture-слушателем |
| `src/features/workflow/WorkflowEnvControl.test.tsx` | интеграционный тест хоткея |
| `src/features/envs/EnvSwitcherMenu.tsx` | keycap-хинт `Ctrl+E`/`⌘E` в шапке |
| `src/features/envs/EnvSwitcherMenu.test.tsx` | тест наличия хинта |

Бэкенд/IPC/`bindings.ts` — **не трогаем** (переиспользуем `setWorkflowEnv`).

## Риски

| Риск | Митигация |
| --- | --- |
| Capture-слушатель глотает чьё-то Ctrl+E (Monaco/диалог) | В Monaco нет дефолтного Ctrl+E; `preventDefault` только при срабатывании, иначе клавиша проходит дальше. |
| macOS: Ctrl+E в текстовом поле = «в конец строки» (emacs-биндинг) | Принимаем (исходный дизайн матчил `ctrlKey||metaKey`); приложение Windows-первичное, на mac основной аккорд — Cmd+E. |
| Стейл-замыкание в слушателе | Эффект перепривязывается на `[envs, activeEnv]` — замыкание всегда свежее. |

## Live-проход (после имплементации)

В WebView2: Ctrl+E циклит env по тайтлбар-pill; на русской раскладке тоже
срабатывает; AltGr+E печатает символ и env не трогает; хинт `Ctrl+E` виден в меню.
