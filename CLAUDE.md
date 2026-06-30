# Handshaker — agent instructions

Handshaker — десктопный gRPC-клиент (Tauri 2 + React 18 + Rust).
Workspace: `crates/handshaker-core` (OS-независимое ядро) · `src-tauri` (IPC) ·
`src` (React-фронтенд).

## Active work

Активная фича — нет (между фичами).

Последняя влитая — **Динамические встроенные подстановки `{{$guid}}` и др.**
(🎉 DONE 2026-06-30, rebase+ff в `main` `0ba7bfa`; план+спека
`2026-06-30-dynamic-builtin-vars` / `2026-06-29-dynamic-builtin-vars-design` в `archive/`) —
шаблоны `{{var}}` получили **6 встроенных динамических переменных** (Postman-стиль с `$`):
`$guid` (UUID v4) · `$guid7` (UUID v7, time-ordered) · `$timestamp` (Unix-секунды) ·
`$unixMs` (Unix-мс) · `$isoTimestamp` (ISO-8601 UTC) · `$randomInt` (0–1000), которые
**генерируются в момент Send** — per-occurrence свежесть (каждое вхождение → своё значение).
**Архитектура (Подход 1):** ядро *распознаёт* билтины, но не подставляет —
`resolve_template_with_diagnostics` кладёт их в новое поле отчёта **`dynamic_vars`** (не
unresolved, не падает); подстановка — один раз в `grpc_invoke_oneshot` (`expand_request_builtins`
над телом + значениями метаданных) через инъектируемый трейт **`BuiltinGenerator`**
(`SystemBuiltins` в проде, `Seq`/`Fake` в тестах). Пользовательская переменная того же имени
**побеждает** (классифицируем только неподставленный остаток). **Зависимости:** только фича `v4`
у `uuid` (v7 уже был); ISO-8601 — вручную (алгоритм Хиннанта `civil_from_days`), `$randomInt` — из
байтов v4-UUID; `time`/`rand`/`chrono` **НЕ** добавлены. **Превью (Вариант A):** билтины
подсвечиваются фиолетовым (`vh-dynamic` #a88fe6) + описываются в автокомплите (`buildVarCandidates`
добавляет `BUILTIN_CANDIDATES`, origin `builtin`); ядро остаётся детерминированным (конкретное
значение в превью не показывается). Ядро `vars/builtins.rs` (источник истины) зеркалится фронтовым
`features/vars/builtins.ts` (`BUILTIN_NAMES`/`isBuiltinName`); строки — в `messages.ts`
(`vars.builtin`). Subagent-driven (6 задач TDD, spec+quality ревью на каждой + финальное ревью =
READY TO MERGE). **Два UI-фоллоуапа по живому фидбеку** (`653ce89`+`a667f2a`+`0ba7bfa`): (1)
`{{$var}}` подсвечивается фиолетовым и в **редакторе тела** Monaco — новый Monarch-токен
`variable.dynamic` (регэксп `{{$ident}}` во всех трёх состояниях токенайзера, тема violet), т.к.
старый var-регэксп не пропускал `$`; (2) отключена rainbow **bracket-pair colorization** (Monaco-
дефолт on) — она двухцветила `{{ }}` плейсхолдера (вложен в `{` объекта ⇒ глубина 1/2 → orchid+blue)
и спорила с приглушённо-серыми `delimiter` темы; выключено **на уровне языка**
`colorizedBracketPairs:[]` (надёжнее опции редактора — применяется при регистрации языка, до маунта
любого редактора, мимо обёртки `@monaco-editor/react`). **Урок (Monaco):** `setLanguageConfiguration`
без явного `colorizedBracketPairs` фолбэчит на `brackets` и красит парные скобки по глубине поверх
токена; пустой список = выключено для языка. Ребейз на `da56d0b` чист (единственный пересекающийся
`messages.ts` смержился автоматически — разные namespace). Гейт: cargo (core 219 · src-tauri 73 ·
doctest) · vitest 1170 · `pnpm build` (tsc+vite) · bindings no-drift. Остаток — live WebView2-проход
(валидность UUID; два `{{$guid}}` различаются; `{{` открывает автокомплит; `{{$foo}}` неизвестный —
красный; фиолет-динамик vs синий-резолв различимы; перезапуск приложения для language-config фикса
скобок).

Предыдущая — **Раскрытие активного запроса в дереве при открытии**
(🎉 DONE 2026-06-30, ff в `main` `7c89c6b`; план-дока нет — прямой TDD, чистый фронт) — открытие
сохранённого запроса (из командной палитры, из обзора коллекции или восстановление при старте)
разворачивает коллекцию+папки-предки и **скроллит строку во вьюпорт**, чтобы только что открытый
метод был виден в сайдбаре, а не оставался спрятанным в свёрнутой ветке. Реализация зеркалит
существующий `editingId`-reveal в `CollectionTree.tsx`: эффект по `activeItemId` открывает предков
через `pathToItem(...)` + второй эффект скроллит раскрытую строку (`scrollIntoView({block:"nearest"})`)
когда она отрендерилась. Два гарда (оба под тестом): **срабатывает один раз на `activeItemId`**
(через `revealedRef`/`scrolledRef`) — последующий перезагруз `collections` (autosave round-trip
отдаёт свежий массив) не переразворачивает свёрнутую вручную папку; **transient** — `onSetExpanded`
не зовётся, открытие запроса не переписывает сохранённое состояние раскрытия. Цель к строке через
существующий `data-node-id` (+`CSS.escape`), `treeRef` на контейнере `role="tree"`. Бэкенд/IPC/
bindings не тронуты. TDD (4 теста). Гейт: vitest **1166** · `tsc -b` · `pnpm build` — зелёные.
**Live-verified** в WebView2 (2026-06-30). **Урок:** reveal-on-open должен быть идемпотентным по
id (ref-гард), иначе перезагруз каталога дерётся с ручным сворачиванием пользователя; см.
[[project_command_palette_quick_search]].

Интеграционная ветка — `main`; фичи ведутся в отдельных worktree-ветках
(`claude/*`) и вливаются в `main` fast-forward.

### Завершённые фичи (всё в `archive/`)

- **Командная палитра — богатые строки результатов запросов** (🎉 DONE 2026-06-29, ff в `main`
  `87230b1`; `2026-06-29-command-palette-richer-rows*` в `archive/`) — строка-**запрос** в палитре
  (`Ctrl/Cmd+K|P`) получила вторую строку: жирное имя над приглушённым `Service/Method` (короткое имя
  сервиса через общий `shortService`/`methodLabel` в `palette.ts`), имя коллекции справа — только в
  плоском режиме; подсветка совпадений — только на имени. Строки → `messages.ts` (`palette`). Багфикс
  `87230b1`: Tab дозаполнял ПЕРВЫЙ ряд, а не выбранный стрелками — читаем выбранный ряд **из DOM**
  (`[data-slot="command-item"][data-selected="true"]`), не `onValueChange` cmdk. Бэкенд/IPC/bindings
  не тронуты. Урок — [[project_command_palette_quick_search]].

- **Конфигурируемый лимит размера gRPC-сообщения — слайдер в Settings → Network** (🎉 DONE
  2026-06-29, rebase+ff в `main` `045f7ba`; `2026-06-29-grpc-max-message-size*` в `archive/`) —
  pref `maxMessageBytes` (байты; `0`=Unlimited; дефолт 16 MiB) → дискретный слайдер на `radix-ui`;
  tonic `Grpc::new` по умолчанию режет приём на 4 MiB → поднять `.max_decoding_message_size` /
  `.max_encoding_message_size` (`usize::MAX`≈без лимита, превышение = `OUT_OF_RANGE 11`); сентинел
  `0→usize::MAX` на границе IPC; только invoke-путь. Live-verified в WebView2. Память —
  `project_grpc_max_message_size_done`.
- **Двойной клик выделяет значение в теле запроса** (🎉 DONE 2026-06-29, ff в `main` `5d0b7b0`;
  `2026-06-29-body-value-dblclick-select*` в `archive/`) — без-модификаторный двойной клик по
  JSON-значению в редакторе **запроса** выделяет значение целиком (строка → текст без кавычек;
  number/bool/null → весь токен; ключ/пунктуация → дефолт Monaco). Чистое ядро
  `bodyview/selectValue.ts` + request-only проводка в `BodyView` (`queueMicrotask`-defer ПОСЛЕ
  word-select Monaco). Live-pass `574405b`: выключен `occurrencesHighlight` (одиночный клик
  рисовал muted-бокс). Бэкенд не тронут. Live-verified в WebView2.
- **Выключение иконок gRPC — опция `off` в тогглере + сдвиг текста** (🎉 DONE 2026-06-27,
  ff в `main`; `2026-06-27-grpc-icon-toggle*` в `archive/`; коммиты `4d5928b` + `36e9c4b`) —
  pref `grpcIcon` расширен `GrpcIconStyle → GrpcIconPref = GrpcIconStyle | "off"` (дефолт
  `solid`); `RequestRow` гейтит оба места рендера на `grpcIcon !== "off"`, иконка — flex-сосед
  лейбла, при отсутствии `gap-0.5` схлопывается ⇒ текст сдвигается даром. Бэкенд не тронут.
  Live-verified в WebView2.
- **gRPC error handling — структурные google.rpc-детали + regex-free классификация
  клиентских ошибок** (🎉 DONE 2026-06-27, ребейз+squash+ff в `main` `3ff5951`;
  `2026-06-26-grpc-error-handling*` в `archive/`) — ядро декодирует `grpc-status-details-bin`
  (google.rpc) через `tonic-types` в serde-free `StatusDetail` → `UnaryOutcome.status_details`
  → `StatusDetailIpc`/`InvokeOutcomeIpc` → `StatusDetails.tsx`; клиентские ошибки без regex
  (`classify_connect_error`/`ConnectKind`, `IpcError::Transport/Cancelled/DeadlineExceeded`) →
  `netDiagnostics.ts` → `ClientFault` → `ClientErrorView`; «лицо ошибки» — центрированный
  `ErrorView` + однострочная сводка `5 NOT_FOUND · 1ms · 0B` в `RespMeta`. **Урок:** C#
  `Status.DebugException` НЕ уходит по проводу — сервер кладёт google.rpc в
  `grpc-status-details-bin`. Память — `reference_tonic_types_status_details`,
  `project_grpc_error_handling_feature`.
- **Split direction toggle — кнопка в титлбаре + хоткей Alt+V/⌥⌘V** (🎉 DONE 2026-06-26,
  ff в `main` `4cc5c0c`; `2026-06-26-split-direction-toggle*` в `archive/`) — прямой тоггл
  ориентации сплита request/response: кнопка `Columns2`/`Rows2` в правом кластере титлбара
  (флипает `prefs.split` напрямую) + чистый `features/shell/splitDirection.ts` (физ. `KeyV`,
  ⌥⌘ на маке) в `WorkflowApp`. Строки → `messages.ts`; заведена коммитимая `.claude/rules/`.
  Live-verified в WebView2. Урок — `project_claude_rules_dir`.
- **Word-wrap toggle в контекстном меню + правый клик по ghost-хинту** (🎉 DONE
  2026-06-26, ff в `main`; `2026-06-26-wordwrap-context-menu*` в `archive/`; коммиты
  `90018b6` + `5910745`) — пункт ПКМ-меню word-wrap в **обоих** редакторах тела (динамич.
  подпись Enable/Disable, без keybinding, dispose+re-add в `useEffect([prefs.wordWrap])`) +
  фикс ПКМ по ghost view-zone подпиской на `editor.onContextMenu` (Monaco не открывает меню
  над view-zone; DOM-листенер на узле бесполезен — оверлеи перехватывают). Урок —
  `project_monaco_viewzone_contextmenu`.
- **Прощение trailing comma в теле запроса при Send** (🎉 DONE 2026-06-25, ff в `main`
  `501f46e`; в `archive/`) — string-aware скраб `strip_trailing_commas(&str) → Cow<str>`
  в ядре (`grpc/invoke/lenient.rs`) убирает висячую запятую **только на проводе** перед
  `serde_json::Deserializer`; прощается только настоящая trailing comma (sparse/двойные —
  честная ошибка serde_json), строки `"x, ]"` не портятся. Бэкенд-only, bindings без дрейфа.
- **Хоткеи: Ctrl/Cmd+R как второй Send + macOS word-wrap `⌥⌘Z`** (🎉 DONE 2026-06-21,
  ff в `main` `5e74fc7`; план-дока нет — прямой TDD, чистый фронт) — **Ctrl/Cmd+R**
  второй аккорд Send (window-listener в `CallPanel` + Monaco-команда в `BodyView`; физ.
  `KeyR`, AltGr-гард; `preventDefault` гасит reload WebView2); **macOS word-wrap**
  `Alt+Z`→`⌥⌘Z` (⌥+буква печатает `Ω`/перехватывается глобально), встроенный Monaco
  `Alt+Z` отвязан `addKeybindingRule({command:null})` в `monaco.ts`.

- **Порядок переменных + хоткей открытия Edit environment** (🎉 DONE 2026-06-20,
  ff в `main`; план+спека `2026-06-20-env-vars-order-edit-hotkey*` в `archive/`) —
  две независимые вещи. **(1) Порядок переменных** переживает рестарт/экспорт:
  `Environment.variables`/`Collection.variables` `HashMap` → `IndexMap`
  (insertion-order). Движок резолва (`VariableSet`) остаётся на `&HashMap` (порядок
  ему безразличен) ⇒ конвертация на двух construction-сайтах (`collections/resolve.rs`,
  `commands/vars.rs`). specta сворачивает `HashMap`/`IndexMap` в один `DataType::Map`
  ⇒ тот же TS `Record` ⇒ **bindings не дрейфят, фронт не тронут**. **(2) Хоткей
  Ctrl+Shift+E** открывает Edit environment активного окружения (нет активного →
  create-mode): чистый предикат `isEnvEditHotkey` (физ. `e.code === "KeyE"` +
  `shiftKey`, AltGr/Shift-гарды — зеркало `cycle.ts`; Ctrl+E цикл vs Ctrl+Shift+E
  edit разводятся Shift) + capture-phase listener в `WorkflowEnvControl` +
  footer-хинт в `EnvSwitcherMenu`. Subagent-driven (core+IPC+predicate+wire, spec+
  quality ревью + финальное ревью = READY TO MERGE). **Live-fix `110ee31` (КЛЮЧЕВОЕ):**
  весь гейт был зелёный, но вживую порядок не сохранялся — переменные алфавитились
  при переоткрытии. Корень: tauri сериализует возвраты команд через
  `serde_json::to_value`, а `serde_json::Value::Object` — `BTreeMap` (алфавит) без
  фичи **`preserve_order`**. Порядок `IndexMap` доживал до файла (прямой `to_writer`,
  без `Value` ⇒ file-store-тесты зелёные), но пересортировывался на границе IPC.
  Фикс — `serde_json = { features = ["preserve_order"] }` в workspace `Cargo.toml`
  (унификация фич применяет к собственному serde_json внутри tauri) + регресс-тест
  `ipc/env.rs::to_value_preserves_variable_insertion_order` (RED→GREEN на границе
  `to_value`). Побочка — скелеты запросов теперь в proto-порядке (улучшение, как
  grpcurl/buf); тело ответа не затронуто (prost-reflect → `serde_json::Serializer`
  напрямую). **Дизайн-решение:** оставлен `IndexMap` (порядок структурен, ноль
  дрейфа bindings), НЕ поле `order` (денормализация+инвариант) и НЕ `Vec<VarEntry>`
  (дрейф bindings+переписать фронт); к `Vec<VarEntry>` перейти ТОЛЬКО при нужде в
  чисто числовых именах переменных (ECMAScript hoisting) или drag-reorder. Урок:
  file-store round-trip НЕ ловит сериализационные баги границы IPC — нужен тест на
  `to_value`. Гейт: `cargo test --workspace` (188+64) · vitest 1084 · tsc · vite
  build · bindings no-drift. Live-verified в WebView2.

- **Автокомплит `{{var}}` — переменные окружения + коллекции** (🎉 DONE 2026-06-19,
  code-complete на ветке `claude/peaceful-gauss-f0850e`; план+спека
  `2026-06-19-var-autocomplete*` в `archive/`) — при наборе `{{` предлагаются
  доступные переменные **активного окружения + привязанной коллекции** (имя ·
  приглушённый превью значения · тег `env`/`collection`; дедуп по имени, активное
  окружение выигрывает у одноимённой переменной коллекции с пометкой `overrides` —
  зеркало приоритета резолва env > collection). **Две поверхности**, общее чистое
  ядро `src/features/vars/candidates.ts` (`buildVarCandidates`) + `varContext.ts`
  (`openVarToken` — каретко-независимый детектор открытого `{{`, грамматика по
  ядровому `VAR_RE` `[^{}]+`; `filterCandidates` — substring, prefix-first;
  `applyVarPick` — вставка `{{name}}`, не дублирует `}}` если уже впереди): (1)
  **тело запроса** — расширён единый Monaco-провайдер на `json-with-vars`
  (var-ветка **до** schema-гейта ⇒ работает и без схемы; триггер `{{`/Ctrl+Space;
  range от офсета `{{`+2 ⇒ точечные имена не дублируют префикс; при нуле совпадений
  **проваливается** в schema-комплит, чтобы шальной незакрытый `{{` его не глушил);
  кандидаты на модель через per-model `WeakMap` `setModelVarCandidates`. (2)
  **plain-инпуты `VarHighlightInput`** (адресная строка + поле значения переменных
  коллекции) — новый каретко-привязанный listbox-дропдаун (позиция через мерочный
  span; клавиатура ↑/↓/Enter/Tab/Esc; a11y по APG editable-combobox —
  `role=combobox`/`listbox`/`option` + `aria-activedescendant`); проп `variables`.
  Источник: фронт собирает сам (`useActiveEnvVars` + `CollectionIpc.variables` из
  каталога) — **бэкенд/IPC/bindings не тронуты**. Триггер/вид сверены с Postman
  (autocomplete на `{{`, имя+значение+scope, overridden) и Insomnia; a11y — WAI-ARIA
  APG combobox. Subagent-driven (7 имплементер-задач TDD + финальное ревью ветки =
  APPROVED после 2 фиксов: provider-fall-through и sync `lastTypedRef` на внешнюю
  смену `value`). Гейт: vitest 1046 · tsc · vite build · bindings no-drift. Остаток
  — вливание в `main` ff + live WebView2-проход (тело: `{{` открывает список, Enter
  вставляет, Send проходит; адрес и поле коллекции — то же; русская раскладка;
  точечные имена; известный лимит — редактирование `{{` в середине строки в
  plain-инпуте, каретка берётся как конец текста).

- **Навигация по большому ответу — minimap · scrollbar · collapse/expand all**
  (🎉 DONE 2026-06-19, ff в `main` `2420325`; план+спека
  `2026-06-19-large-response-navigation*` в `archive/`) — три независимых улучшения
  навигации по большому JSON-телу ответа (read-only Monaco `BodyView mode="response"`).
  **(1) Minimap** только на редакторе ответа (`BODY_READONLY_OPTIONS`), блок-форма
  (`renderCharacters:false`), **size-gated — видна только при переполнении вьюпорта**:
  чистый предикат `shouldShowMinimap(contentHeight, viewportHeight)`
  (`bodyview/minimapGate.ts`), переоценка живьём на `onDidContentSizeChange` +
  `onDidLayoutChange` с гардом `minimapOn` (toggling minimap меняет ширину, не высоту ⇒
  без петли); адаптивно к resizable-панелям. Request-редактор без minimap.
  **(2) Scrollbar** в базовых `EDITOR_OPTIONS`: `verticalScrollbarSize` 8→14 + `scrollByPage`
  (постраничный клик по жёлобу; прыжок «куда угодно» закрыт минимапой). **(3) Collapse
  all / Expand all** — пункты **right-click контекстного меню** тела (НЕ кнопки): чистый
  `attachFoldActions(editor)` (`bodyview/foldActions.ts`, группа `"1_folding"` над
  decode/copy-группой `"9_cutcopypaste*"`, без keybinding) дёргает встроенные
  `editor.foldAll`/`unfoldAll`; вешается в response-ветке `onMount` рядом с
  `attachDecodeActions`, диспозится в обоих teardown. **Бэкенд/IPC/bindings не тронуты.**
  Изначально (Tasks 4–6) collapse/expand были icon-кнопками в шапке `ResponsePanel` через
  мост `BodyViewHandle`/`forwardRef` (BodyView→ResponseBody→ResponsePanel `useRef`); по
  live-фидбеку **перенесены в контекстное меню**, весь ref-мост удалён как мёртвый код
  (commit `2420325`). Subagent-driven (6 задач TDD, spec+quality ревью + финальное ревью
  ветки = READY TO MERGE; relocation-амендмент ревью = APPROVED). Гейт: vitest 1036 · tsc ·
  vite build (бинд-дрейфа нет). Live-verified в WebView2 (2026-06-20). **Live-pass амендмент
  (2026-06-20, ff в `main` `d46c810`):** минимапа теперь **заменяет** вертикальный скроллбар,
  а не соседствует с ним — при переполнении показывается одна минимапа с закреплённым слайдером
  (`showSlider:"always"`), вертикаль скрывается (`vertical:"hidden"`), убирая «две полосы рядом»
  (best-practice: VS Code держит скроллбар поверх минимапы, два параллельных бара — антипаттерн).
  Size-gate вынесен из response-only в **оба** редактора тела (request+response) для единообразия;
  маленькое тело — обычный скроллбар (`auto`, страхует 8px-зазор гейта), горизонталь не тронута
  (word-wrap off → длинные значения скроллятся вбок). Чистый `minimapToggleOptions`
  (`bodyview/minimapGate.ts`) переуказывает **полный** `scrollbar` в обоих состояниях
  (`editor.updateOptions` заменяет объект опции целиком, не мёржит). TDD (helper-юнит +
  интеграционный тест на оба режима). Гейт: vitest 1041 · tsc · vite build. Live-verified в WebView2.

- **Collapse all / Expand all — кнопки в шапке панели коллекций** (🎉 DONE 2026-06-18,
  ребейз+ff в `main`; план+спека `2026-06-17-collection-expand-collapse-all*` в
  `archive/`) — две icon-кнопки в ряду-шапке «Collections» (слева от `SortControl`):
  **Collapse all** (`ChevronsDownUp`) и **Expand all** (`ChevronsUpDown`),
  сворачивают/разворачивают **все коллекции верхнего уровня** одним кликом (вложенные
  папки сохраняют своё состояние — осознанный выбор «top-level only»). Персист как у
  ручного тоггла через существующий IPC `collection_set_expanded` (`itemId=null`);
  **бэкенд/IPC/bindings не тронуты**. Обе кнопки `disabled` при активном фильтре
  (дерево и так force-развёрнуто) и при нуле коллекций. **Мостик шапка↔дерево:**
  `CollectionTree` (где живёт локальный `open: Set` — истина рендера) экспонирует
  крошечный императивный handle `{ expandAll, collapseAll }` через `forwardRef` +
  `useImperativeHandle`; `SidebarShell` держит `useRef<CollectionTreeHandle>` и зовёт
  его из кнопок — без подъёма ~80 строк логики `open`/клавиатуры/drag. `expandAll`
  добавляет id коллекций в `open` (не затирая открытые папки) + персист по каждой;
  `collapseAll` удаляет только id коллекций. Subagent-driven (2 задачи TDD, spec+quality
  ревью на каждой + финальное ревью ветки = READY TO MERGE). Чистый фронт, 2 файла
  (`CollectionTree.tsx` + `SidebarShell.tsx`) + тесты. При вливании — ребейз на
  актуальный `main` (с командной палитрой): два source-файла байт-идентичны базе и
  `main` ⇒ конфликтов нет; после ребейза свежий воркстри требовал `pnpm install`
  (палитра добавила `cmdk` — старый node_modules не имел его, падали тесты палитры).
  Пост-ребейз гейт: vitest 1025 · tsc · vite build. Остаток — live WebView2-проход.

- **Командная палитра — быстрый поиск по коллекциям и методам** (🎉 DONE 2026-06-18,
  ребейз+ff в `main`; план+спека `2026-06-16-command-palette-quick-search*` в `archive/`)
  — вызываемая палитра (`Ctrl/Cmd+K` и `Ctrl/Cmd+P`, матч по **физической** клавише
  `e.code` — раскладко-независимо; capture-фаза + `stopPropagation`, т.к. `Ctrl+K` —
  чорд-префикс Monaco) на `cmdk`/shadcn `Command` (новая зависимость `cmdk@1.1.1`).
  **Суперсет-поиск:** плоский fuzzy (группы Collections + Requests) по умолчанию + drill
  `коллекция → TAB → «.» → метод → TAB → Enter` поверх. «Метод» = сохранённый запрос,
  открывается в Focus через существующий discard-guarded `openRequest`; Enter на коллекции
  без метода → Collection Overview. TAB принимает/дополняет (коллекция → scope-чип +
  авто-«.»; запрос → имя в инпут), «.» коммитит лучшую коллекцию, Backspace снимает чип,
  Esc закрывает. Реюз воскрешённого `palette.ts` (+`rankCollections`) и `fuzzy.ts`; чистое
  ядро `paletteModel.ts` (state→rows) + тонкий `CommandPalette.tsx` + предикат
  `paletteHotkey.ts`; **бэкенд/IPC/bindings не тронуты** (поиск по `cat.tree`). Гочи cmdk:
  проп `prefix` коллизит с HTML-атрибутом `<input prefix>` → `Omit<…,"prefix">`; подсветка
  uncontrolled (`onValueChange` + фолбэк `result.rows[0]`, без `value=`) — иначе глохнет
  Enter; `shouldFilter={false}` под свой ранжер; синтетические `value` (`r0…`) обходят
  нормализацию value; scope-режим фильтрует методы по имени (плоский — по полному haystack).
  Subagent-driven (7 задач TDD, spec+quality ревью на каждой + финальное ревью = READY TO
  MERGE; пофикшены тип-коллизия `prefix` и a11y `DialogDescription`); гейт после ребейза на
  актуальный `main`: tsc · vitest 1017 · build. Live-verified в WebView2.

- **Импорт/экспорт коллекций** (🎉 DONE 2026-06-17, ребейз+ff в `main`; план+спека
  `2026-06-16-collection-import-export*` в `archive/`) — неразрушающий import/export
  (не backup): один формат файла `Envelope{ kind:"handshaker-export", collections[],
  environments[] }` (нативные serde-шейпы ядра; активное окружение не хранится).
  **Import = merge**: коллекции по `id` (есть → обновить, нет → добавить), окружения
  по `name` (переменные сливаются, импорт побеждает на общих ключах, цвет — только
  если задан); ничего не удаляется, активное окружение не трогается; валидация
  (`kind`) до любой мутации (битый/чужой файл → ошибка, данные целы). **Три точки
  входа**, один модуль `transfer.ts` + хук `useImportFlow` + нейтральный
  `ImportSummaryDialog` (сводка adds/updates, без разрушительного confirm): Export
  одной коллекции из меню строки; Export(всё)/Import из ⋯-меню панели коллекций и из
  Settings → Import / Export. Ядро `handshaker-core/src/bundle.rs`
  (`write_bundle`/`read_bundle` поверх `Envelope`/atomic-write) + 3 IPC-команды
  (`bundle_export(path, collection_id?)` · `bundle_import_inspect` · `bundle_import_apply`)
  поверх `collection_store`/`env_store`; `tauri-plugin-dialog` (нативные save/open;
  файловый I/O в Rust). После импорта — `catalog.reload()` + рефетч списка окружений
  по `bumpEnvRevision()` (в `WorkflowEnvControl` и `SavedAuthEditor`), без перезагрузки
  страницы. **Секреты — lossless** (в файле открытым текстом, осознанный выбор для
  личного переноса; «без секретов» — отмеченная точка расширения). Subagent-driven
  (12 задач TDD + ревью merge-логики на Task 4 + финальное ревью ветки = APPROVED).
  При вливании — ребейз на `main` (который независимо добавил `tauri-plugin-dialog`):
  конфликты mod-списков/capability/импортов разрешены, dialog dep+плагин
  дедуплицированы. Пост-ребейз гейт: `cargo test --workspace` · `pnpm test` 975 · `tsc`
  · `vite build` · bindings no-drift. Остаток — live WebView2-проход.
- **Декодирование base64-значений в ответе** (🎉 DONE 2026-06-16, ребейз+ff в
  `main`; план+спека `2026-06-15-base64-value-decoder*` в `archive/`) — ПКМ по
  строковому значению в Body ответа → меню (best practice, 2 группы с разделителем):
  **Copy decoded base64** (декод на бэкенде → буфер; бинарь → тост→Save) · **Copy
  value** (сырая строка → буфер) над разделителем; **Save decoded base64 to file…**
  (декод → нативный Save As) · **Save base64 to file…** (сырой base64 verbatim →
  файл) под ним. Диалога нет (убран по live-фидбеку); полное значение берётся из
  JSON-дерева (`node.value`), т.к. в редакторе строка может быть элидирована.
  **Copy value** гейтится на `hsValueIsString` (остальные на `hsValueIsB64`);
  **built-in «Copy» Monaco убран** из response-редактора (дублировал Copy value;
  Ctrl+C жив). Бэкенд: core `base64`-модуль (lenient decode + classify + `infer`) +
  IPC `base64_inspect`/`base64_save`/`base64_save_encoded` (`tauri-plugin-dialog`).
  Subagent-driven (7 задач) + live-pass амендменты: timing-фикс гейта ПКМ-меню
  (`onMouseDown` по правой кнопке — mousedown раньше Monaco-`contextmenu`),
  исключение UUID/hex из гейта, убран «Command Palette» из Monaco-меню
  (`contextMenuCleanup`, F1 жив), decode→буфер вместо диалога, перекомпоновка меню +
  убран built-in Copy. Гейт (пост-ребейз): `cargo test --workspace` · `pnpm test`
  964 · `tsc` · `vite build` · bindings no-drift. Live-verified в WebView2.
- **Save request — создание коллекции из диалога** (🎉 DONE 2026-06-16, влита в
  `main` fast-forward, коммиты `d473744` (feat) + `6bd0545` (refactor по код-ревью);
  план+спека `2026-06-16-save-request-create-collection*` в `archive/`) — щель в UX:
  в диалоге Save request кнопка «＋ New collection» показывалась только при нуле
  коллекций (`!target`), а на открытии `target` авто-ставился на первую коллекцию →
  при ≥1 коллекции единственная affordance — «＋ New folder in …», и новую коллекцию
  из сохранения создать было нельзя (снять выделение в пикере тоже нельзя). Фикс —
  чистый фронт, один компонент (`src/features/catalog/SaveRequestDialog.tsx` + тест):
  под деревом-пикером две affordance — «＋ New collection» (всегда) + «＋ New folder
  in "X"» (только при выбранном `target`); неявный признак «что создаём» (`!target`)
  заменён явным состоянием `addingKind: "collection" | "folder" | null`, `commitNew`
  ветвится по нему (collection → pending-коллекция, target → её корень; folder →
  pending-папка под target; явные early-return — «закрывать инпут только при
  успешном коммите»). Граница: ноль коллекций → видна только «New collection».
  `applyReco`/reco-чип/`originBound`/`CollectionPicker`/`treeNav`/`savePicker` и
  бэкенд/IPC/bindings НЕ тронуты (`onCreateCollection` уже был проброшен из
  `WorkflowApp` = `cat.createCollection`). Subagent-driven в worktree (имплементер
  TDD + spec-ревью ✅ + quality-ревью APPROVED + полиш по ревью); ветка ответвилась
  от `origin/main`, на финале ребейзнута на локальный `main` (бесконфликтно — пути
  не пересекаются) и влита ff. Гейт: vitest 938 (935 + 3) · `pnpm build` (tsc +
  vite). Live-verified в WebView2 (2026-06-16).
- **Well-known types — честный тип в Contract/hints, голый proto3-JSON скаляр во
  вставке** (🎉 DONE 2026-06-16, влита в `main` fast-forward; fix-коммиты `5da3db6`
  + `cfd85e9`; багфикс + доработка по живому фидбеку, отдельного план-дока нет) —
  баг: автокомплит/скелет подставляли `google.protobuf.Int64Value` (и любой
  well-known-тип) как вложенное сообщение `{"value": 0}`, а десериализатор отправки
  (`prost_reflect::DynamicMessage::deserialize`, `grpc/invoke/mod.rs`) следует
  каноническому proto3 JSON и отвергает map: `invalid type: map, expected a 64-bit
  signed integer or decimal string`. Объём — «скалярные WKT»: 9 обёрток (`*Value`)
  → голый скаляр (`0`/`""`/`false`/`0.0`) + `Timestamp` → `"1970-01-01T00:00:00Z"`
  · `Duration` → `"0s"` · `FieldMask` → `""`. `Struct`/`Value`/`ListValue`/`Any`/
  `Empty` НЕ трогаются (`Empty` и так `{}`). **Финальный дизайн — разделение
  «отображение vs вставка»:** схема (`grpc/invoke/schema.rs`) отдаёт WKT честным
  `Message` с реальным именем, поэтому Contract-таб и ghost-хинты показывают
  `Int64Value`/`Timestamp` как в reflection (НЕ схлопнутый `int64`). Голый скаляр —
  только во вставке: скелет тела (`grpc/invoke/skeleton.rs` + ядро `well_known.rs`:
  `classify` + `skeleton_default`) и автокомплит (`completion.ts` через новый общий
  `src/lib/wellKnown.ts` — `SCALAR_WKT` full_name → number/string/bool; `scaffold`
  вставляет скаляр, `descendSchema` не лезет в `value`). Contract рисует обёртку
  именем без избыточного блока `{ value }` (`proto.ts` фильтрует WKT-блоки + рисует
  имя не-кликабельным токеном). **DTO/bindings/IPC не тронуты.** Путь к финалу:
  первый заход (`5da3db6`) схлопывал WKT прямо в схеме → `int64` тёк в Contract/
  hints; доработка (`cfd85e9`, по фидбену) откатила схему к честному `Message` и
  перенесла скалярную форму во фронт-вставку; ядровый `label()` убран как мёртвый.
  Маппинг сверен с protobuf.dev (ProtoJSON) + исходниками prost-reflect 0.14
  (`de/kind.rs`/`de/wkt.rs`: матч WKT по full_name, голый `0` принят, `FieldMask
  ""` → пустая маска). TDD red→green; репро-тест: скелет с Int64Value через
  `DynamicMessage::deserialize` = Ok (до фикса падал `invalid type: map`). Гейт
  (после доработки): `cargo test --workspace` (core 171 · src-tauri 52; 0 failed,
  0 warnings) · vitest 935 · tsc · vite build · bindings no-drift. Остаток — live
  WebView2-проход (автокомплит → `"limit": 0`, Send проходит; Contract/ghost
  показывают `Int64Value`).
- **Send button + response polish — тултип · фикс дёрганья · анимация прихода**
  (🎉 DONE 2026-06-16, влита в `main` fast-forward; план+спека
  `2026-06-16-send-response-ui-polish*` в `archive/`) — три полиш-пункта вокруг
  отправки и показа ответа. (1) Тултип кнопки Send показывает только хоткей
  `Ctrl Enter` (слово «Send» убрано — дублировало подпись `▶ Send`). (2) Фикс
  дёрганья Send↔Cancel на быстрых (<5 мс) ответах: общий хук
  `useBusyDelay(active, delayMs)` (`src/lib/use-busy-delay.ts`) — delay-половина
  паттерна spin-delay, гейтит свап на 250 мс в обоих барах (`DraftAddressBar` +
  `AddressBar`), так что суб-250 мс вызов кнопку не дёргает; `min-w-[5rem]` против
  рефлоу; `onSend` сделан идемпотентным (гард `status==="sending"`) против двойной
  отправки в пред-гейт окне; `ResponsePanel` переведён на тот же хук (единый
  источник 250 мс ⇒ комета и Cancel синхронны). `minDuration` сознательно нет —
  гейтится actionable-кнопка Cancel, не спиннер (осознанное отступление от
  дефолтов spin-delay). (3) Анимация прихода: press-отклик `active:scale-[.97]` на
  Send (мгновенное «система услышала» до 250-мс кометы) + fade-in тела ответа
  `.hs-fade-in` (120 мс, `--ease-out`) на success-body/`ErrorView`/`ClientErrorView`;
  reduced-motion гасит глобальным ресетом. Бэкенд/IPC/bindings не тронуты (только
  FE + 6 строк CSS). Subagent-driven (6 задач TDD + финальное ревью ветки:
  APPROVED, 0 находок). При вливании — ребейз на `main` поверх word-wrap-мерджа,
  1 конфликт (`CLAUDE.md`) разрешён; пост-ребейз гейт: vitest 925 · tsc · vite
  build. Остаток — живой WebView2-проход (нужен реальный быстрый gRPC-эндпойнт).
- **Word Wrap — настройка + хоткей Alt+Z** (✅ DONE 2026-06-16, влита в `main`
  fast-forward; план+спека `2026-06-16-word-wrap-setting*` в `archive/`) — перенос
  длинных строк в обоих редакторах тела стал управляемым pref'ом `wordWrap`,
  **выключен по умолчанию** (как в VS Code: длинное base64-значение уезжает вправо
  горизонтальным скроллом, а не «башней» под ключом — это было следствие Monaco
  `wordWrap: "on"`, а не `renderJsonTree`). Управление: тумблер **Settings →
  Appearance → Word wrap** + глобальный **Alt+Z**. Чистый `src/features/shell/
  wordWrap.ts` (`isWordWrapHotkey` — физ. `code === "KeyZ"`, AltGr/Shift-гарды,
  раскладко-независимо; `useWordWrapHotkey` — capture-фаза + `stopPropagation`,
  подавляет встроенный Alt+Z Monaco `editor.action.toggleWordWrap`, иначе
  рассинхрон с pref). `BodyView` **переопределяет** `wordWrap` из pref в `useMemo`;
  живое переключение — через controlled `options`-проп (обёртка `@monaco-editor/
  react@4.7.0` сама зовёт `updateOptions` на смену идентичности options — явный
  эффект убран на ревью как избыточный; см. память). `monaco.ts` base причёсан на
  `"off"` (косметика, оверрайд всё равно решает). Поверхности — `Switch` в
  `AppearancePane` + строка `Alt Z` в `KeyboardPane`. Бэкенд/IPC/bindings не
  тронуты. Subagent-driven (3 юнита, spec+quality ревью на каждом + финальное
  ревью ветки = READY TO MERGE); гейт: vitest 920 · tsc · vite build. Остаток —
  live-проход в WebView2 (длинное base64 при off скроллится; Alt+Z вкл/выкл;
  тумблер синхронен; русская раскладка; AltGr+Z не трогает; переживает рестарт).
- **Стартовый сплэш — убрать белую вспышку при старте** (🎉 DONE 2026-06-14,
  влита в `main` ff `f9629d5`; план+спека `2026-06-14-startup-splash-screen*` в
  `archive/`) — холодный старт больше не мигает белым. **Два слоя:** (1)
  `backgroundColor: "#0A0A0A"` на окне в обоих конфигах — Tauri красит фон **и
  окна, и webview** ещё до парсинга HTML (parity-тест сторожит синхронность
  base↔mac, RFC7396); (2) самодостаточный инлайн-оверлей `#splash` в `index.html`
  (H-Bridge mark из иконки + вордмарк на **system-font**, чтобы не ловить Inter-
  FOUT; рисуется до JS/CSS-бандла) с мягким пульсом лого. Снятие: чистый
  `src/features/shell/splash.ts` (`splashFadeMs` + идемпотентный DOM-раннер
  `dismissSplash`: `.is-hiding`→fade→remove, чистит safety-таймаут) + тонкий
  `useEffect` в `WorkflowApp` по маунту оболочки. **Без форс-минимума показа**
  (best practice NN/g: <1с индикатор не нужен, фейк-задержка — анти-паттерн;
  быстрый старт → быстрый уход, фон стабильно тёмный ⇒ нет мелькания);
  safety-таймаут 8с (сломанный бандл не оставит мёртвый сплэш); пульс жив при
  reduced-motion (политика приложения), fade — нет. Бэкенд/IPC/bindings не
  тронуты (только 2 JSON-конфига). Subagent-driven (4 задачи, spec+quality ревью
  на каждой + финальное ревью ветки); гейт: vitest 890 · tsc · vite build ·
  `cargo check` (`generate_context!` принял конфиг); live-verified в WebView2.
- **Ctrl+E — циклическое переключение окружения** (🎉 DONE 2026-06-13, влита в
  `main` ff `d6f36b3`; план+спека `2026-06-13-env-cycle-hotkey*` в `archive/`) —
  глобальный Ctrl+E / Cmd+E циклит env активного воркфлоу на следующий по кругу
  (исключая «No environment»; нет активного → первый; ноль env → no-op). Матч по
  **физической** клавише `e.code === "KeyE"` (раскладко-независимо — на ЙЦУКЕН
  `e.key` был бы «у», и хоткей бы не сработал); AltGr (`altKey`)/Shift/repeat-
  гарды; capture-фаза `window`-листенера (как `useUiZoom`), `preventDefault`
  только при реальном срабатывании. Чистый модуль `src/features/envs/cycle.ts`
  (`isEnvCycleHotkey` + `nextEnvName`) + тонкий `useEffect` в `WorkflowEnvControl`
  (переиспользует `workflowStore.setWorkflowEnv`; **бэкенд/IPC/bindings не
  тронуты**) + некликабельный футер-хинт «Cycle environment · Ctrl+E/⌘E» в
  `EnvSwitcherMenu` (изначально стоял в шапке у `+`, перенесён вниз по live-
  фидбеку). Subagent-driven (3 задачи, spec+quality ревью на каждой + финальное
  ревью ветки: конфликтов хоткеев нет — Monaco биндит только Ctrl+Enter); гейт:
  vitest 880 · tsc clean; live-verified в WebView2 (в т.ч. русская раскладка).
- **Collection vars resolve + индикация резолва** (🎉 DONE 2026-06-13,
  ребейз+ff в `main` `675f1fe`; план+спека `2026-06-13-collection-vars-resolve*`
  в `archive/`) — переменные коллекции теперь участвуют в `{{var}}`-резолве (был
  баг: бэкенд клал пустую collection-мапу). IPC `vars_resolve(template, ctx?)`
  получил опциональный `VarsResolveCtxIpc` (`collection_id` → бэкенд читает vars из
  `collection_store`; оверлеи `collection_vars`/`env_vars` для несохранённых рядов
  редакторов; `ctx=None` ⇒ прежнее поведение); ядро (`resolve_template_with_
  diagnostics`, env > collection) не тронуто. `Step.collectionId` штампуется из
  `DraftOrigin` инвариантом в workflow store; `varsCtxFor`/`varsResolverFor`
  прокидывают контекст во все живые пути (Send, адрес/reflection, message-schema,
  OAuth2). Индикация: инлайн-подсветка `{{var}}` в адресной строке и в редакторе
  переменных коллекции (`VarHighlightInput` — токен красится по resolve-state,
  резолв-значение едет инлайном/в тултипе; палитра — pref в Settings); Edit
  Environment оставлен на однострочном `VarResolveLine` (его многострочный
  `ValueCell` под длинные JWT инлайн не ложится). Мёртвый `ResolvesPreview` удалён.
  При ребейзе на `main` разрешён 1 конфликт в `CallPanel.tsx`: взяты оба —
  `effectiveAuth` (фикс 16 UNAUTHENTICATED из main) + `varsResolverFor(step.
  collectionId)` (collection-ctx этой ветки). Заодно влита **чистка Settings**
  (коммит `675f1fe`): удалены нереализованные пункты (панели Editor/Data целиком,
  мёртвые строки Appearance/Network, Keyboard Ctrl+E) + мёртвые prefs/CSS. Гейт:
  tsc clean · vitest 863 · `cargo test --workspace` · bindings no-drift. Остаток:
  живой WebView2-проход.
- **OAuth2 client-credentials auth per-collection** (🎉 DONE 2026-06-12,
  ребейз+ff в `main`; план+спека `2026-06-12-oauth2-client-credentials*` в
  `archive/`) — 4-й вид auth «OAuth2» у коллекции: все поля (`token_url`,
  `client_id`, `client_secret`, `scopes`, `header_name`, `prefix`) — `{{var}}`-
  шаблоны, резолвятся фронтом по активному окружению. Ядро:
  `auth/oauth2.rs` — парсинг token-ответа (дробный `expires_in`, дефолт 300s),
  `TokenCache` (skew 30s, ключ = resolved token_url+client_id+secret+scopes, без
  header/prefix) + async `Oauth2TokenProvider` (reqwest `rustls-tls` →
  **ring без aws-lc-rs** через feature-unification с tonic; `rustls-no-provider`
  есть только в master reqwest). Env-scoping: `environments: Vec<String>` на
  обоих видах auth (пусто ⇒ все; «No environment» ⇒ неактивен при скоупе),
  гейт и в core-resolve-цепочке, и в `resolveAuthHeader`. IPC:
  `auth_oauth2_fetch_token` (`expires_in_secs: u32` — specta режет u64) +
  `auth_invalidate`; на gRPC UNAUTHENTICATED(16) кэш инвалидируется, авторетрая
  нет (дизайн). UI: форма OAuth2 в `SavedAuthEditor` + кнопка «Get token» +
  «Apply in environments»-popover; секрет нигде не логируется/не показывается.
  Subagent-driven, spec+quality ревью на каждой задаче + финальное ревью ветки;
  гейт: tsc clean · vitest 821 · cargo workspace · bindings no-drift · build.
  Live-pass amendments (2026-06-13, ff `b2c1707`…`12443b4`): **наследование auth
  коллекции на Send** — живой путь отправки видел только `step.auth` (= `none`,
  у запроса нет auth-редактора) и заголовок не прикреплялся вовсе (16 на каждом
  вызове); добавлен чистый `pickEffectiveAuth` (зеркало core `resolve_auth_chain`),
  `CallPanel.originAuth` из живого дерева каталога — управляет Send, Auth-табом и
  history-снапшотом. **Get token показывает/копирует токен** — `force_fetch`
  возвращает `TokenResponse`, `OAuth2TokenInfoIpc.access_token` (память сессии),
  превью 20 символов + Copy через `tauri-plugin-clipboard-manager`
  (`navigator.clipboard` в WebView2 — за permission-промптом). vitest 832.
  Остаток: live WebView2-проход против реального OIDC-эндпойнта.
- **UI polish batch #2 — зум · dark-only · quick-add · duplicate · ghost-фикс ·
  последний response** (🎉 DONE 2026-06-12, влито в `main` ff; план+спека
  `2026-06-12-ui-polish-batch2*` в `archive/`) — шесть независимых пунктов:
  **зум UI** (`webview.setZoom`, Ctrl+=/−/0 с AltGr-guard, степпер+Reset в
  Settings → Appearance, персист через `prefs.zoom`; `src/features/shell/zoom.ts`);
  **dark-only** (`prefs.theme`/светлая Monaco-тема/кнопка в Titlebar выпилены
  целиком); **quick-add** (hover-«+» на строке метода в MethodPicker → авто-сейв
  по `planQuickAdd` (дедуп → открыть существующий) и немедленное открытие
  созданного через `openSavedRequest`); **duplicate** (иконка `CopyPlus` в хедере
  FocusView origin-bound черновика → копия рядом + открытие; IPC
  `collection_duplicate_item` теперь отдаёт id фронту); **ghost-фикс** (обёртка
  @monaco-editor/react глушит `onChange` на программные правки — пересчёт ghost
  по дивергенции `lastText` в BodyView); **последний response сессии**
  (`lastExecutedFor` по истории воркфлоу сидирует Response при `openSavedRequest`
  и `applyMethodSelection`; заодно убран stale-ответ чужого метода). Live-pass
  amendments: статус «Сохранено» → приглушённая `Save`-иконка с тултипом.
  Subagent-driven, spec+quality ревью на каждой задаче + финальное ревью ветки;
  гейт: tsc clean · vitest 818 · cargo core+app · build; live-проверка в WebView2.
- **Контракт метода → таб Contract (proto-вид, Group B #3)** (🎉 DONE
  2026-06-12, влито в `main` ff; планы 2026-06-10/11/12 + спеки в `archive/`) —
  плавающий оверлей `ContractPanel` удалён; контракт — 4-й таб Response-панели
  (Body · Trailers · Headers · Contract): подсвеченный proto-исходник (номера
  полей, `optional`, enum-числа), клик по типу скроллит к определению.
  **Единый вид** (без переключателя Request|Response): rpc-строка
  `rpc M(In) returns (Out);` с кликабельными корнями + объединённый
  дедуплицированный по `full_name` листинг обеих сторон (`renderContractDoc`
  в `src/features/contract/proto.ts`; `?` вместо отсутствующей стороны + muted
  «…-схема недоступна»). Live-pass amendments: таб-логика Body-first (дефолт
  всегда Body, Send безусловно → Body, автодефолта на Contract нет);
  response-side inlay-тип-хинты удалены целиком (hints.ts/провайдер/
  schema-проброс; `pathTo` → validate.ts; `bodyHints` управляет только
  ghost'ом запроса, кнопка переименована в «Field hints»). Subagent-driven,
  spec+quality ревью на каждой задаче + финальное ревью ветки; гейт: tsc clean ·
  vitest 784 · cargo core+app · build; две live-итерации в WebView2.
- **Edit Environment — масштаб окна + длинные значения + L1-вёрстка** (🎉 DONE
  2026-06-11, влито в `main` ff, commits `2b4d2da`…`d9ea0da`) — `EnvEditorDialog`
  перестал быть фикс-коробкой 672px без кап-высоты: `DialogContent` стал flex-колонкой
  `w-[min(90vw,960px)]` · `max-h-[85vh]` · `min-h-[70vh]` с внутренним скроллом списка
  переменных (`min-h-0 flex-1 overflow-auto`) — имя+цвет и Save/Cancel запинены. Имя и
  цвет собраны в один identity-ряд: цвет — точка → новый shadcn-`ui/popover` (на
  унифиц. `radix-ui`) с палитрой 10 свотчей; описание `sr-only`; колонка Key стала 1/2.
  Значение переменной — авто-`<textarea>` (`ValueCell`): в покое одна обрезанная строка,
  по фокусу перенос+рост до капа `168px` → внутренний скролл (key-ячейка осталась
  `Input`; `scrollHeight===0` в jsdom → рост/скролл проверены живьём). Бэкенд/модель не
  тронуты (`Record<string,string>`). Subagent-driven, spec+quality ревью на каждой
  задаче + финальное ревью ветки; 705 vitest/tsc/build зелёные, живо подкручено в WebView2.
- **Env switcher — полиш меню + ручной порядок окружений** (🎉 DONE 2026-06-11,
  влито в `main` ff, commits `41d1be5`…`6751e43`) — порядок стал свойством списка:
  оба `EnvironmentStore`-импла перешли с `HashMap` на `Vec<Environment>` (порядок
  вектора = порядок пользователя) + `reorder(names)` на трейте + общий
  exact-permutation хелпер `reordered()` → новый IPC `env_reorder` персистит дропы.
  Фронт: убрана алфавитная сортировка, `+` в шапке меню (вместо нижнего «New env…»),
  `EnvPill` удалён как мёртвый код, env-строки draggable внутри Radix-меню с
  `DropLine`-индикатором (drop коммитит `hint.zone` последнего dragOver — WYSIWYG,
  без пересчёта по координатам дропа), rename сохраняет позицию (upsert+delete с
  повторной выдачей порядка). Строка «No environment» — **Inter 200 / `font-extralight`**
  (300 визуально неотличим от 400 на 14px серого — подобрано по харнессу с измерением
  computed font-weight; каждый вес требует своего `@fontsource/inter/NNN.css`, иначе
  тихий фолбэк). Subagent-driven, spec+quality ревью на каждой задаче + финальное
  ревью ветки; core/tauri/699 vitest/lint/build зелёные; живо проверено в WebView2.
- **Request body autocomplete + message-schema endpoint (Group B #4)** (🎉 DONE
  2026-06-10, влито в `main` ff, commits `2328d93`…`afa5aa9`) — новый бэкенд
  `grpc_message_schema` строит плоскую `MessageSchema` (root + map сообщений/enum'ов,
  ссылки по full-name → рекурсие-безопасно, без depth-cap) из закешированного
  `prost-reflect` пула (та же кеш-дисциплина, что у скелета). Фронт: best-effort фетч +
  `useMessageSchema`, схема кладётся на Monaco-модель через `WeakMap`, один
  `CompletionItemProvider` на `json-with-vars` — контекстный комплит (ключи + enum +
  скелеты вставки). Ядро — чистые `resolveCompletionContext`/`descendSchema`/
  `build*Suggestions` (`src/features/bodyview/completion.ts`). UX по-Postman'овски: `"`
  форс-открывает виджет (`onKeyUp`→`triggerSuggest`, только если есть что предложить),
  quote-aware `filterText` (иначе расширённый на кавычки range отфильтровывал всё),
  `wordBasedSuggestions:off` (ключи не текли в value), компактный suggest-шрифт
  (опция + `globals.css`). 681 FE-тестов + core + lint + build зелёные, живо проверено
  в WebView2. #3 контракт-вью — следующий спек (переиспользует ту же схему).
- **Request body — preserve edits + Reset-to-template (Group A)** (✅ DONE 2026-06-09,
  влито в `main` ff, commits `0724907`…`36c5205`) — смена метода больше не затирает
  отредактированное тело: чистая `isPristineBody` (пусто/`{}`/структурно == скелету)
  решает, можно ли заменить; `applyMethodSelection` стал условным (stateless: пересборка
  скелета старого метода + deep-equal). Кнопка `↺` «Reset to template» (ghost `icon-xs`,
  правый край таб-стрипа Request, disabled без метода) → `resetBodyToTemplate`; откат —
  родным Ctrl+Z (контролируемый `value` Monaco применяется через `executeEdits`). 647
  тестов зелёные, живо проверено в WebView2. Group B (#3/#4) — отдельный спек.
- **Manual «Check for updates» button** (✅ DONE 2026-06-09, влито в `main` ff
  `8f364a4`) — ручная проверка обновлений из тайтлбара (иконка `RefreshCw` + бейдж
  доступности, переживающий «Later») и из Settings → About; результат всегда через
  тост. Флаги `manual`/`hasUpdate` в `useUpdateCheck`, лёгкий `UpdaterProvider`.
  Живо проверено в WebView2. Остаток: ручной mac-проход.
- **Workflow-центричный редизайн UI (#1–#5 + #4b)** — база всего UI. Старый shell
  `src/App.tsx` и легаси `src/features/collections/*` удалены как мёртвый код.
- **Рефакторинг коллекции сервисов (Postman-style библиотека)** — `plan-00-index` …
  `plan-11` (🎉 feature-complete). Каталог-дерево заменено персистентной
  пользователь-редактируемой библиотекой поверх `CollectionIpc` (metadata-rows,
  single-auth, pinned/usage, персист контракт-кэша). Лист = сохранённый вызов;
  create — request-first. Остаток вне scope: «Save As» на `SaveRequestDialog`.
- **Draft address-bar redesign** и **Draft breadcrumb + unified tab strip** — хедер
  черновика (full-path брэдкрамб, TLS-замок в host, full-width MethodPicker с
  reflection-футером, единый underline-таб-стрип).
- **Unified body view** — общий Monaco-вьюер запрос/ответ (folding, native Ctrl+F,
  Ctrl+dblclick copy, элизия >4096). Остаток: ручной Monaco-прогон.
- **macOS-стиль титлбара** (🎉 feature-complete, merge `ac2bab7`) — нативный
  «светофор» через Tauri `TitleBarStyle::Overlay` (`tauri.macos.conf.json`,
  RFC7396-мердж), `isMacOS`/`useIsFullscreen`-ветвление `Titlebar.tsx` (без
  wordmark/кнопок окна, левый инсет). Остаток: ручная визуальная проверка на Mac.
- **UI-анимации (motion tokens + B + E + progress)** (✅ code-complete, branch
  `claude/serene-feistel-e53ca1`, commits `4db8b83`…`b7cd1ea`) — дизайн-токены
  движения (`--motion-fast/base`, `--ease-standard/out/in`) + глобальный
  `prefers-reduced-motion` (спиннер/пульс остаются живыми) в `globals.css`;
  скользящий индикатор таба в `underline-tabs.tsx` (одна замеряемая `transform`-полоса,
  гаснет при `busy`). DnD-аффорданс (после лайв-ревью): **`DropLine`** — тонкая
  non-reflowing тинт-линия вставки before/after (без осцилляции; прежний раздвигающий
  `DropSlot` удалён) + fill-тинт области для `inside`, и forgiving-дроп в тело
  коллекции (`dnd.ts`/`planDrop` не тронуты). Прогресс-«комета» `hs-tab-progress` —
  transform-only, первый проход вырастает из активного таба (`--bar-start` в
  `ResponsePanel`), reduced-motion фолбэк (статичный пульс), показ через ~250ms-гейт
  (быстрые ответы не мелькают). 614 тестов/tsc/build зелёные; визуалка проверена
  лайв (vite HMR). Остаток: mac/WKWebView-проход.

Источник истины по статусу любой фичи — статус-баннер её план-файла в `archive/`,
не эта строка.

## Build / test

- Свежий worktree: сначала `pnpm install`, затем собрать `dist/` **до** компиляции
  `src-tauri` — `generate_context!` требует `dist/`.

## Архивирование завершённых планов и спеков

Конвенция вынесена в правило `.claude/rules/archiving-completed-work.md`
(коммитимое, авто-загружается каждую сессию).

## Compact Instructions

При компактификации **всегда сохраняй**:
- путь к активному плану и какая задача в работе;
- список файлов, изменённых в этой сессии, и любую незакоммиченную работу;
- команды сборки/тестов, которые использовались.

## Session cadence (исполнение большого плана по сессиям)

- **`/clear`** между задачами/под-планами → перечитать активный план → продолжить.
- **`/compact`** только посреди одной задачи, когда контекст заполнился.
- В план-файлах границы фаз помечены **🧹 /clear-чекпойнт** — на них завершай
  сессию и начинай свежую.

### Инструкция после `/clear` — минимальная

Всё состояние уже в этом `CLAUDE.md` + в статус-баннере активного план-файла
(статус, ветка, коммиты, follow-up'ы, команды). Дублировать это в сообщении не нужно.
Хендофф = **один шаг + путь к плану**, например:

> Продолжай. Следующий шаг — Plan #N: `docs/superpowers/plans/2026-06-03-plan-0N-*.md`.
> Оутлайн — детализируй до TDD, затем исполняй.

Если план уже TDD-детальный — «продолжай с первой невыполненной задачи», например:

> Продолжай. Plan-01: `docs/superpowers/plans/2026-06-06-plan-01-backend-persistence.md`
> — исполняй задача-за-задачей, subagent-driven.

Режим — subagent-driven (дефолт, не спрашивать). За деталями агент читает баннер плана сам.

## Agent skills

Конфигурация для engineering-скиллов Matt Pocock (`triage`, `to-issues`, `to-prd`,
`diagnosing-bugs`, `tdd`, `improve-codebase-architecture` и др.). Подробности — в
`docs/agents/*.md`; здесь — однострочные сводки.

### Issue tracker

Задачи ведутся в GitHub Issues репо `xlcorg/handshaker` (через `gh` CLI); внешние PR
**не** являются поверхностью triage. См. `docs/agents/issue-tracker.md`.

### Triage labels

Канонический словарь labels (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`) — строки совпадают с именами ролей. См.
`docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` в корне указывает на по-контекстные `CONTEXT.md`
(`handshaker-core` / `src-tauri` / `src`); ADR — в корневом и по-контекстных `docs/adr/`.
См. `docs/agents/domain.md`.
