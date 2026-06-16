# Handshaker — agent instructions

Handshaker — десктопный gRPC-клиент (Tauri 2 + React 18 + Rust).
Workspace: `crates/handshaker-core` (OS-независимое ядро) · `src-tauri` (IPC) ·
`src` (React-фронтенд).

## Active work

Нет активной фичи в работе. Последняя влитая — **Send button + response polish —
тултип · фикс дёрганья · анимация прихода** (🎉 DONE 2026-06-16, влита в `main`
fast-forward; план+спека `2026-06-16-send-response-ui-polish*` в `archive/`;
остаток — live-проход в WebView2; см. ниже).

Интеграционная ветка — `main`; фичи ведутся в отдельных worktree-ветках
(`claude/*`) и вливаются в `main` fast-forward.

### Завершённые фичи (всё в `archive/`)

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
