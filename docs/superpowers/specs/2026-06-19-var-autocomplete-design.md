# Автокомплит `{{var}}` — окружение + переменные коллекции — дизайн

**Дата:** 2026-06-19 · **Статус:** утверждён (брейншторм в сессии)

## Проблема

`{{var}}`-шаблоны уже **подсвечиваются** (резолв-цвет, inline-чип значения,
тултип) в адресной строке и редакторе переменных коллекции, и **резолвятся** на
живых путях. Но при наборе ссылки переменную надо помнить наизусть: нет
автокомплита. Пользователь печатает `{{` и должен сам вспомнить точное имя
(`host`? `base-url`? `api_root`?), хотя фронт уже знает полный набор доступных
переменных (активное окружение + переменные привязанной коллекции).

Цель — при наборе `{{` предлагать доступные переменные с превью значения и
указанием источника, на двух главных поверхностях ввода: **тело запроса**
(Monaco) и **plain-инпуты `VarHighlightInput`** (адресная строка + поле значения
переменных коллекции).

## Подтверждение best practice

- **Postman** ([autocomplete blog](https://blog.postman.com/autocomplete-and-tooltips-for-variables-are-here/),
  [docs](https://learning.postman.com/docs/sending-requests/variables/)):
  триггер — фигурная скобка прямо в URL/params/headers/body; подсказка показывает
  **имя + текущее значение + scope** + пометку про **overridden** переменную;
  порядок — активное окружение, затем глобальные; известный баг
  [#5067](https://github.com/postmanlabs/postman-app-support/issues/5067)
  (дропдаун не появляется, когда курсор не в конце поля) и
  [#2336](https://github.com/postmanlabs/postman-app-support/issues/2336)
  (коллекционные переменные исторически не попадали в автокомплит).
- **Insomnia** ([env docs](https://docs.insomnia.rest/insomnia/environment-variables/)):
  триггер — `{{` + пробел/имя либо **Ctrl+Space**, в любом текстовом поле.
- **Monaco** ([CompletionItemProvider](https://microsoft.github.io/monaco-editor/typedoc/interfaces/languages.CompletionItemProvider.html)):
  несколько провайдеров на язык мёржатся; `resolveCompletionItem` — для ленивого
  до-вычисления дорогих деталей по фокусу.
- **WAI-ARIA APG** ([combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/),
  [editable combobox + list autocomplete](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/)):
  DOM-фокус остаётся на `<input>`, навигация по списку — через
  `aria-activedescendant`; стрелки двигают его, JS скроллит активную опцию в
  видимость.

## Решение

Чистый фронт. **Бэкенд / IPC / bindings не трогаем** — фронт уже располагает всем
для сборки кандидатов (`envList()` + активное окружение воркфлоу;
`CollectionIpc.variables` из каталога). Никакого pref-тумблера: автокомплит
ненавязчив (срабатывает только в `{{`-контексте).

### 1. Источник кандидатов (общий)

Новый чистый модуль `src/features/vars/candidates.ts`:

```ts
export type VarOrigin = "env" | "collection";
export interface VarCandidate {
  name: string;
  value: string;        // сырое сохранённое значение (превью)
  origin: VarOrigin;
  /** true, если одноимённая переменная коллекции перекрыта этой env-переменной. */
  overrides?: boolean;
}

/** Активное окружение выигрывает у одноимённой переменной коллекции (как в резолве).
 *  Порядок: сначала env, потом collection (иерархия Postman + приоритет резолва). */
export function buildVarCandidates(
  envVars: Record<string, string> | undefined,
  collectionVars: Record<string, string> | undefined,
): VarCandidate[];
```

- Дедуп по имени, **env > collection**: при коллизии остаётся env-кандидат с
  `overrides: true`; одноимённый collection-кандидат не добавляется.
- Нет активного окружения → только collection; черновик без коллекции → только
  env; пусто с обеих сторон → `[]`.
- Значение — **сырое** (мгновенно, без веера resolve-IPC). Цепочечное значение
  (`{{other}}…`) показывается как есть. Резолвнутое-по-фокусу (Postman-parity)
  через `resolveCompletionItem` — отмеченная точка расширения, не в первый заход.

Сборка живёт во `FocusView`/`WorkflowApp`-слое (там доступны активный воркфлоу,
`envName`, список окружений и `collectionId` шага); кандидаты прокидываются вниз
в обе поверхности.

### 2. Фильтр по партиалу

`src/features/vars/varContext.ts` — общий детектор «курсор внутри открытого
`{{`-токена» (каретко-независимо, учли баг Postman #5067):

```ts
/** Если курсор стоит внутри незакрытого `{{…`, вернуть партиал (текст после `{{`
 *  до курсора) и позицию `{{`. Иначе null. `}}` уже впереди допускается. */
export function openVarToken(textBeforeCaret: string): { partial: string; tokenStart: number } | null;
```

Фильтрация кандидатов по `partial` (case-insensitive substring; ранжирование —
префикс выше подстроки) — общая функция, переиспользуется обеими поверхностями.

### 3. Поверхность A — тело запроса (Monaco)

Расширяем **существующий** провайдер `registerBodyCompletion`
(`src/features/bodyview/completion.ts`), не вводя второй:

- Проверка `openVarToken(textBefore)` ставится **до** schema-гейта
  (`if (!schema) return`), поэтому var-подсказки работают и без схемы.
- В `{{`-контексте возвращаем **только** var-подсказки (взаимоисключение со
  schema-enum/bool — иначе они бы смешались); вне контекста — прежняя
  schema-логика без изменений.
- `'{'` добавляется в `triggerCharacters` (вместе с текущими `'"' : ' '`);
  Ctrl+Space работает штатно. Триггер — именно `{{` (вторая скобка): одиночная
  `{` в JSON открывает объект, не переменную.
- Подсказка: `label = name`, `detail = value` (+ origin/overridden в detail или
  через `kind`-иконку), `insertText`:
  - если впереди уже есть `}}` → вставить только `name`;
  - иначе → `name}}` (авто-закрытие), курсор после `}}`.
- Кандидаты доезжают до глобального провайдера через **per-model WeakMap**
  (зеркало `setModelSchema`): `setModelVarCandidates(model, candidates)`,
  выставляется в `BodyView` из пропа.

`BodyView` получает новый проп `varCandidates?: VarCandidate[]`; ставит их на
модель в `onMount` и в эффекте при смене (как делает с `schema`). Force-open
`onKeyUp` (текущая логика для `"`) дополняется кейсом второй `{`: если
`openVarToken` непустой и есть кандидаты — `triggerSuggest`.

### 4. Поверхность B — `VarHighlightInput` (адрес + значения коллекции)

Бесшовный каретко-привязанный дропдаун в самом `VarHighlightInput`
(`src/features/vars/VarHighlightInput.tsx`) — оба хоста (адресная строка через
`DraftAddressBar`, поле значения через `VariablesBlock`) получают его
автоматически. Новый проп `variables?: VarCandidate[]`.

- **Позиционирование**: переиспользуем уже существующий backdrop-mirror
  (`contentRef`-спан повторяет текст символ-в-символ). Меряем `offsetWidth`
  подстроки до `tokenStart` → пиксельное x-смещение `{{`; дропдаун рендерится у
  этой точки под полем. Это снимает обычную боль «каретка в `<input>`».
- **Открытие**: набор `{{`/печать партиала после `{{` → открыт, если есть
  совпадения; Esc/потеря фокуса/закрытие токена (`}}`) → закрыт.
- **Клавиатура** (APG editable-combobox + list autocomplete): ↑/↓ — двигают
  активную опцию (`aria-activedescendant`, скролл в видимость), Enter/Tab —
  принять, Esc — закрыть и съесть клавишу. Стрелки/Enter в открытом дропдауне не
  доходят до обычной навигации поля.
- **Вставка**: заменяем `{{partial` → `{{name}}` (или `{{name` если `}}` уже
  впереди), курсор после `}}`; вызываем `onChange`. Подсветка/чип резолва
  пересчитываются как обычно.
- **a11y**: `<input>` получает `role=combobox` `aria-expanded` `aria-controls`
  `aria-autocomplete=list` `aria-activedescendant`; popup — `role=listbox`,
  строки — `role=option` с `id`. DOM-фокус всегда на инпуте.
- **Рендер строки** — вид A: иконка-переменная · имя · приглушённый превью
  значения (truncate) · тег `env`/`collection`; на env-кандидате с
  `overrides` — мелкая пометка перекрытия.

### 5. Проводка кандидатов

- **Адресная строка**: `DraftAddressBar` уже получает `resolveKey` (активное
  окружение). Добавляем проп `variables`, который собирается выше из
  active-env + `collectionId` шага.
- **Поле значения переменных коллекции** (`VariablesBlock`): кандидаты =
  active-env + переменные **этой** коллекции. (Опционально позже — учитывать
  несохранённые ключи рядов редактора, чтобы только что добавленная переменная
  была сразу видна; в первый заход — сохранённые.)
- **Тело**: `varCandidates` из того же сборщика во `FocusView`.

## Краевые случаи

- Ноль кандидатов → дропдаун/виджет не открывается (нет «No suggestions»-шума —
  как уже сделано для schema-комплита в `BodyView`).
- Нет активного окружения → только collection-кандидаты; черновик без коллекции
  → только env.
- Курсор внутри `{{`, но `}}` уже есть впереди → детектор всё равно срабатывает
  (вставляем без второго `}}`).
- Имя в обоих источниках → одна строка (env), помечена overridden.
- Reduced-motion — анимаций у дропдауна нет (мгновенное появление), специально
  ничего гасить не нужно.

## Вне scope

- Auth/header plain-инпуты (`SavedAuthEditor`, метаданные) — сейчас даже не
  подсвечивают `{{`; их подключение — отдельная история.
- Подсказки из **неактивных** окружений (резолвятся красным → вводят в
  заблуждение).
- Резолвнутое-по-фокусу значение (`resolveCompletionItem` / resolve focused
  option) — документированная точка расширения, не первый заход.
- Глобальные переменные (в продукте их нет) и `Secret`-тип.
- Любые изменения бэкенда/IPC/bindings.

## Тестирование

- `candidates.test.ts` — дедуп env-wins + `overrides`, порядок env→collection,
  пустые источники.
- `varContext.test.ts` — `openVarToken`: каретка в середине, `}}` впереди, нет
  токена, вложенность скобок, партиал.
- `completion` (body) — в `{{`-контексте отдаёт var-подсказки (и без схемы);
  вне контекста — schema-подсказки без регрессий; insert с/без `}}` впереди.
- `VarHighlightInput.test.tsx` — открытие по `{{`, фильтр, ↑/↓/Enter/Esc,
  вставка `{{name}}`, a11y-атрибуты (`role`, `aria-activedescendant`).

## Файлы (ориентировочно)

Новое: `src/features/vars/candidates.ts` (+тест), `src/features/vars/varContext.ts`
(+тест). Правки: `src/features/bodyview/completion.ts`,
`src/features/bodyview/BodyView.tsx`, `src/features/vars/VarHighlightInput.tsx`,
`src/features/workflow/DraftAddressBar.tsx`,
`src/features/catalog/overview/VariablesBlock.tsx`, сборщик кандидатов во
`FocusView`/`WorkflowApp`-слое. Бэкенд — без изменений.
