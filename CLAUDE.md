# Handshaker — agent instructions

Handshaker — десктопный gRPC-клиент (Tauri 2 + React 18 + Rust).
Workspace: `crates/handshaker-core` (OS-независимое ядро) · `src-tauri` (IPC) ·
`src` (React-фронтенд).

## Active work — нет активного плана

Все спланированные фичи **завершены** и перенесены в
`docs/superpowers/{specs,plans}/archive/` (см. правило «Архивирование завершённых
планов и спеков» ниже). Новую работу начинай с брейншторма/спека → плана, и пока
план активен — держи его описание здесь. Интеграционная ветка — `main`; фичи
ведутся в отдельных worktree-ветках (`claude/*`) и вливаются в `main` fast-forward.

**Следующая запланированная работа — Group B #3: просмотр контракта метода.**
Бэкенд-эндпоинт схемы полей уже есть (`grpc_message_schema` → плоская `MessageSchema`,
отгружена в Group B #4): он несёт `proto_name`/`oneof_group`/типы, которые контракт-вью
переиспользует напрямую — отдельный эндпоинт не нужен. Спек ещё не написан — начинай
с брейншторма.

### Завершённые фичи (всё в `archive/`)

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

Когда фича доведена до конца (все задачи плана выполнены и закоммичены, баннер
плана помечен как завершённый — напр. «🎉 feature-complete»), **перенеси** её
план-файл(ы) и соответствующий спек в архив:

- планы → `docs/superpowers/plans/archive/`
- спеки → `docs/superpowers/specs/archive/`

Переноси через `git mv` (история сохраняется), одним коммитом вида
`docs(archive): <feature> plan+spec`. В каталогах `plans/`/`specs/` остаются
только активные документы. После переноса обнови соответствующую строку
«Active work» в этом `CLAUDE.md` (и индекс памяти, если он ссылается на план).

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
